import os
import io
import json
import base64
import asyncio
import requests
import uvicorn
import numpy as np
import soundfile as sf
import torch
import torchaudio as ta
from fastapi import FastAPI, UploadFile, File, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Optional
import edge_tts
from dotenv import load_dotenv

# Load API keys from environment (.env)
load_dotenv()

# --- Configuration ---
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")

app = FastAPI(title="Delulu — Emotional Support Companion Backend")

# Enable CORS for frontend interaction
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Supported prebuilt voice names from Google Gemini (kept for frontend compatibility)
VALID_VOICES = {"Aoede", "Kore", "Puck", "Charon", "Fenrir"}

# --- Chatterbox & Indic Parler TTS Configuration ---
# Auto-detect device: MPS for Apple Silicon (M2 Mac), otherwise CPU
if torch.backends.mps.is_available():
    CHATTERBOX_DEVICE = "mps"
elif torch.cuda.is_available():
    CHATTERBOX_DEVICE = "cuda"
else:
    CHATTERBOX_DEVICE = "cpu"
print(f"\n🔊 TTS inference device: {CHATTERBOX_DEVICE}")

# Languages supported by Chatterbox
CHATTERBOX_SUPPORTED_LANGS = {"en"}

# Lazy-loaded model references
_chatterbox_en_model = None
_indic_parler_model = None
_indic_parler_tokenizer = None
_indic_parler_description_tokenizer = None

# Speaker mappings for ai4bharat/indic-parler-tts
INDIC_SPEAKERS = {
    "te": {
        "aoede": "Lalitha",
        "kore": "Ananya",
        "puck": "Prakash",
        "charon": "Kartik",
        "fenrir": "Siddharth"
    },
    "hi": {
        "aoede": "Divya",
        "kore": "Kriti",
        "puck": "Rohit",
        "charon": "Aarav",
        "fenrir": "Kabir"
    },
    "ta": {
        "aoede": "Kavitha",
        "kore": "Meera",
        "puck": "Valluvar",
        "charon": "Arjun",
        "fenrir": "Sanjay"
    },
    "kn": {
        "aoede": "Anu",
        "kore": "Aditi",
        "puck": "Gagan",
        "charon": "Rohan",
        "fenrir": "Vikram"
    },
    "ml": {
        "aoede": "Anjali",
        "kore": "Rimi",
        "puck": "Midhun",
        "charon": "Rahul",
        "fenrir": "Hari"
    }
}

# --- Pydantic Schemas ---
class ChatMessage(BaseModel):
    role: str
    content: str

class ChatRequest(BaseModel):
    text: str
    language: str
    history: Optional[List[ChatMessage]] = []

class SpeakRequest(BaseModel):
    text: str
    language: str
    gender: Optional[str] = None

class GreetRequest(BaseModel):
    language: str
    gender: Optional[str] = None

# --- Gemini Helper Functions ---

def call_gemini_chat(prompt: str, json_mode: bool = False) -> str:
    """
    Calls Google Gemini 2.5 Flash model for conversational responses.
    """
    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY is not configured in .env file.")
        return ""

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}
    
    payload = {
        "contents": [
            {
                "parts": [{"text": prompt}]
            }
        ]
    }
    
    if json_mode:
        payload["generationConfig"] = {
            "responseMimeType": "application/json"
        }
        
    try:
        response = requests.post(url, headers=headers, json=payload, timeout=15)
        if response.status_code != 200:
            print(f"Gemini Chat API Error: {response.status_code} - {response.text}")
            return ""
        
        res_data = response.json()
        text = res_data["candidates"][0]["content"]["parts"][0]["text"]
        return text.strip()
    except Exception as e:
        print(f"Exception calling Gemini Chat: {e}")
        return ""

def get_chatterbox_en_model():
    """
    Lazily loads the English-only Chatterbox TTS model on first use.
    """
    global _chatterbox_en_model
    if _chatterbox_en_model is None:
        from chatterbox.tts import ChatterboxTTS
        print("\n⏳ Loading Chatterbox English TTS model...")
        _chatterbox_en_model = ChatterboxTTS.from_pretrained(device=CHATTERBOX_DEVICE)
        print("✅ Chatterbox English TTS model loaded successfully!")
    return _chatterbox_en_model

def get_indic_parler_model_and_tokenizers():
    """
    Lazily loads the ai4bharat/indic-parler-tts model and tokenizers on first use.
    """
    global _indic_parler_model, _indic_parler_tokenizer, _indic_parler_description_tokenizer
    if _indic_parler_model is None:
        from parler_tts import ParlerTTSForConditionalGeneration
        from transformers import AutoTokenizer
        print("\n⏳ Loading ai4bharat/indic-parler-tts model...")
        model_id = "ai4bharat/indic-parler-tts"
        _indic_parler_model = ParlerTTSForConditionalGeneration.from_pretrained(model_id).to(CHATTERBOX_DEVICE)
        _indic_parler_tokenizer = AutoTokenizer.from_pretrained(model_id)
        _indic_parler_description_tokenizer = AutoTokenizer.from_pretrained(_indic_parler_model.config.text_encoder._name_or_path)
        print("✅ ai4bharat/indic-parler-tts model loaded successfully!")
    return _indic_parler_model, _indic_parler_tokenizer, _indic_parler_description_tokenizer

def call_chatterbox_tts(text: str) -> Optional[bytes]:
    """
    Generates natural speech using English-only Chatterbox TTS.
    Returns WAV bytes or None on failure.
    """
    try:
        model = get_chatterbox_en_model()
        wav = model.generate(text)
        wav_io = io.BytesIO()
        ta.save(wav_io, wav, model.sr, format="wav")
        wav_io.seek(0)
        return wav_io.read()
    except Exception as e:
        print(f"Chatterbox TTS error: {e}")
        return None

def call_indic_parler_tts(text: str, lang_key: str, speaker_name: str) -> Optional[bytes]:
    """
    Generates highly natural speech using ai4bharat/indic-parler-tts.
    """
    try:
        model, tokenizer, desc_tokenizer = get_indic_parler_model_and_tokenizers()
        
        # Build description incorporating the specific speaker's name to set character
        description = f"{speaker_name}'s voice is clear, with a natural tone and no background noise."
        
        input_ids = tokenizer(text, return_tensors="pt").input_ids.to(CHATTERBOX_DEVICE)
        prompt_input_ids = desc_tokenizer(description, return_tensors="pt").input_ids.to(CHATTERBOX_DEVICE)
        
        generation = model.generate(
            input_ids=input_ids,
            prompt_input_ids=prompt_input_ids
        )
        
        audio_arr = generation.cpu().numpy().squeeze()
        
        wav_io = io.BytesIO()
        sf.write(wav_io, audio_arr, model.config.sampling_rate, format="WAV", subtype="PCM_16")
        wav_io.seek(0)
        return wav_io.read()
    except Exception as e:
        print(f"Indic Parler TTS error: {e}")
        return None

def transliterate_to_tenglish(text: str) -> str:
    """
    Transliterates Telugu script to Tenglish using Gemini.
    """
    has_telugu = any('\u0c00' <= char <= '\u0c7f' for char in text)
    if not has_telugu:
        return text

    prompt = (
        "You are a helpful transliteration tool. "
        "Convert the following Telugu script text into casual Tenglish (Telugu words written in Roman/English script). "
        "Keep it highly natural, exactly how people text each other on WhatsApp or social media. "
        "Do not translate to English, only transliterate. "
        "Return ONLY the transliterated text with no other explanation or quotes.\n\n"
        f"Text to convert: {text}"
    )
    result = call_gemini_chat(prompt)
    return result if result else text

# --- Endpoints ---

@app.post("/transcribe")
async def transcribe_audio(file: UploadFile = File(...)):
    """
    Transcribes audio blob using Groq Whisper.
    If the transcription is in Telugu script, it transliterates it to Tenglish.
    """
    if not GROQ_API_KEY:
        raise HTTPException(status_code=500, detail="GROQ_API_KEY is not configured on the server.")

    try:
        audio_bytes = await file.read()
        
        url = "https://api.groq.com/openai/v1/audio/transcriptions"
        headers = {"Authorization": f"Bearer {GROQ_API_KEY}"}
        files = {
            "file": (file.filename or "audio.webm", audio_bytes, "audio/webm")
        }
        data = {
            "model": "whisper-large-v3",
            "response_format": "verbose_json"
        }

        loop = asyncio.get_event_loop()
        response = await loop.run_in_executor(
            None, lambda: requests.post(url, headers=headers, files=files, data=data)
        )

        if response.status_code != 200:
            raise HTTPException(status_code=response.status_code, detail=response.text)

        response_data = response.json()
        raw_transcript = response_data.get("text", "")
        detected_lang = response_data.get("language", "en")

        final_transcript = raw_transcript
        if "te" in detected_lang.lower() or any('\u0c00' <= char <= '\u0c7f' for char in raw_transcript):
            final_transcript = transliterate_to_tenglish(raw_transcript)

        return {
            "transcript": final_transcript,
            "language": detected_lang
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/chat")
async def chat_agent(payload: ChatRequest):
    """
    Fetches LLM response using Gemini 2.5 Flash.
    Returns display_text (Tenglish for Telugu) and tts_text (Telugu Script for natural speaking).
    Acts as 'Delulu' - a warm, empathetic, and emotionally supportive companion.
    """
    lang = payload.language.lower()

    safety_rule = (
        "\n\nIMPORTANT SAFETY RULE: If the user mentions self-harm, suicide, wanting to die, or being in crisis, "
        "respond with immediate warmth and gently encourage them to reach out to a real person - "
        "mention India's KIRAN helpline: 1800-599-0019 (24/7, free). Do not try to handle crisis situations alone."
    )
    
    if "te" in lang or "tenglish" in lang:
        system_prompt = (
            "You are Delulu, a warm and empathetic AI companion. Listen carefully to what the user shares about their feelings, day, or problems. "
            "Respond with genuine warmth, validation, and gentle support - like a caring friend, not a therapist. "
            "Keep responses conversational and natural, not clinical. "
            "Respond in Tenglish (Telugu words in Roman script) when user speaks Telugu, or match their language otherwise. "
            "Respond in casual WhatsApp-style conversation (1-2 sentences). "
            "Since the language is Telugu, you must output a JSON response containing two fields:\n"
            "1. 'display_text': The response written in Tenglish (Telugu words in Roman/English script). e.g., 'Ayyyo, em parvaledu. Nenu unnanu ga.'\n"
            "2. 'tts_text': The exact same response written in native Telugu script characters. e.g., 'అయ్యో, ఏం పర్వాలేదు. నేను ఉన్నాను గా.'\n"
            "Never use English translations in either field. Keep it purely Telugu/Tenglish. "
            "Example JSON: {\"display_text\": \"Baadhapadaku na bangaram, nenu eppudu nee thode unnanu.\", \"tts_text\": \"బాధపడకు నా బంగారం, నేను ఎప్పుడు నీ తోడే ఉన్నాను.\"}"
            + safety_rule
        )
    elif "hi" in lang:
        system_prompt = (
            "You are Delulu, a warm and empathetic AI companion. Listen carefully to what the user shares about their feelings, day, or problems. "
            "Respond with genuine warmth, validation, and gentle support - like a caring friend, not a therapist. "
            "Keep responses conversational and natural, not clinical. "
            "Respond in natural Hindi (1-2 sentences). Output JSON containing:\n"
            "1. 'display_text': casual Hindi or Hinglish.\n"
            "2. 'tts_text': Native Devanagari Hindi script for TTS reading.\n"
            "Example: {\"display_text\": \"Koi baat nahi yaar, main hoon na tumhare saath.\", \"tts_text\": \"कोई बात नहीं यार, मैं हूँ ना तुम्हारे साथ।\"}"
            + safety_rule
        )
    else:
        system_prompt = (
            "You are Delulu, a warm and empathetic AI companion. Listen carefully to what the user shares about their feelings, day, or problems. "
            "Respond with genuine warmth, validation, and gentle support - like a caring friend, not a therapist. "
            "Keep responses conversational and natural, not clinical. "
            "Respond naturally in 1-2 sentences. Output JSON containing:\n"
            "1. 'display_text': casual display text.\n"
            "2. 'tts_text': native script text for the TTS system to read.\n"
            "Example: {\"display_text\": \"Oh, I am so sorry you feel that way. I am right here for you.\", \"tts_text\": \"Oh, I am so sorry you feel that way. I am right here for you.\"}"
            + safety_rule
        )

    prompt_builder = f"System Instruction: {system_prompt}\n\n"
    if payload.history:
        for msg in payload.history[-8:]:
            role_label = "User" if msg.role == "user" else "Delulu"
            prompt_builder += f"{role_label}: {msg.content}\n"
    prompt_builder += f"User: {payload.text}\n"
    prompt_builder += "Delulu (Output JSON):"

    try:
        loop = asyncio.get_event_loop()
        raw_json_response = await loop.run_in_executor(
            None, lambda: call_gemini_chat(prompt_builder, json_mode=True)
        )
        
        parsed = json.loads(raw_json_response)
        display_text = parsed.get("display_text", "")
        tts_text = parsed.get("tts_text", "")
        
        if not display_text:
            display_text = raw_json_response
        if not tts_text:
            tts_text = display_text

        return {
            "display_text": display_text,
            "tts_text": tts_text
        }
    except Exception as e:
        print(f"Failed to parse or get Gemini chat response: {e}")
        return {
            "display_text": "Technical error, please try again.",
            "tts_text": "Technical error, please try again."
        }

@app.post("/speak")
async def generate_speech(payload: SpeakRequest):
    """
    Generates speech audio using Chatterbox TTS for English,
    and ai4bharat/indic-parler-tts for Indic languages (Telugu, Hindi, Tamil, Kannada, Malayalam).
    """
    lang_code = payload.language.lower()
    
    if "te" in lang_code:
        lang_key = "te"
    elif "hi" in lang_code:
        lang_key = "hi"
    elif "ta" in lang_code:
        lang_key = "ta"
    elif "kn" in lang_code:
        lang_key = "kn"
    elif "ml" in lang_code:
        lang_key = "ml"
    else:
        lang_key = "en"

    selected_voice = (payload.gender or "Aoede").lower()

    wav_bytes = None
    loop = asyncio.get_event_loop()

    # Step 1: English -> Chatterbox TTS
    if lang_key == "en":
        print(f"Attempting Chatterbox TTS for language '{lang_key}'...")
        wav_bytes = await loop.run_in_executor(
            None, lambda: call_chatterbox_tts(payload.text)
        )

    # Step 2: Indic Languages -> ai4bharat/indic-parler-tts
    else:
        # Get speaker name (fallback to Lalitha for Telugu, Divya for Hindi, etc.)
        lang_speakers = INDIC_SPEAKERS.get(lang_key, {})
        speaker_name = lang_speakers.get(selected_voice)
        if not speaker_name:
            # Pick first available speaker for this language as fallback
            speaker_name = list(lang_speakers.values())[0] if lang_speakers else "Lalitha"

        print(f"Attempting Indic Parler TTS for language '{lang_key}' with speaker '{speaker_name}'...")
        wav_bytes = await loop.run_in_executor(
            None, lambda: call_indic_parler_tts(payload.text, lang_key, speaker_name)
        )

    if not wav_bytes:
        raise HTTPException(status_code=500, detail="Speech generation failed.")

    return StreamingResponse(io.BytesIO(wav_bytes), media_type="audio/wav")

@app.post("/greet")
async def greet_user(payload: GreetRequest):
    """
    Triggers an initial welcoming voice message.
    """
    lang = payload.language.lower()

    if "te" in lang:
        return {
            "display_text": "Hi na bangaram! Ela unnaru? E roju nee roju ela gadichindi?",
            "tts_text": "హాయ్ నా బంగారం! ఎలా ఉన్నారు? ఈ రోజు నీ రోజు ఎలా గడిచింది?"
        }
    elif "hi" in lang:
        return {
            "display_text": "Hi dear! Kaise ho aap? Aur aaj ka din kaisa raha?",
            "tts_text": "हाय डियर! कैसे हो आप? और आज का दिन कैसा रहा?"
        }
    elif "ta" in lang:
        return {
            "display_text": "Hi chellam! Eppadi irukkinga? Innikku eppadi pona naal?",
            "tts_text": "ஹாய் செல்லம்! எப்படி இருக்கீங்க? இன்னிக்கு எப்படி போன நாள்?"
        }
    elif "kn" in lang:
        return {
            "display_text": "Hi chinna! Hego iddeera? E roju nimma dina hegirittu?",
            "tts_text": "ಹಾಯ್ ಚಿನ್ನಾ! ಹೇಗಿದ್ದೀರಾ? ಈ ದಿನ ನಿಮ್ಮ ದಿನ ಹೇಗಿತ್ತು?"
        }
    elif "ml" in lang:
        return {
            "display_text": "Hi ponnu! Enganeyundu? Innathe divasam enganeyundu?",
            "tts_text": "ഹായ് പൊന്നു! എങ്ങനെയുണ്ട്? ഇന്നത്തെ ദിവസം എങ്ങനെയുണ്ട്?"
        }
    else:
        return {
            "display_text": "Hi dear! How are you doing today? How was your day?",
            "tts_text": "Hi dear! How are you doing today? How was your day?"
        }

if __name__ == "__main__":
    uvicorn.run("server:app", host="0.0.0.0", port=8000, reload=True)
