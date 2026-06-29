import os
import io
import json
import base64
import asyncio
import requests
import uvicorn
import numpy as np
import soundfile as sf
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

# Supported prebuilt voice names from Google Gemini
VALID_VOICES = {"Aoede", "Kore", "Puck", "Charon", "Fenrir"}

# Voice Mapping to Microsoft Edge Neural Voices (Fallback)
EDGE_VOICE_MAPPING = {
    "te": {
        "female": "te-IN-ShrutiNeural",
        "male": "te-IN-MohanNeural"
    },
    "hi": {
        "female": "hi-IN-SwaraNeural",
        "male": "hi-IN-MadhurNeural"
    },
    "en": {
        "female": "en-IN-NeerjaNeural",
        "male": "en-IN-PrabhatNeural"
    },
    "ta": {
        "female": "ta-IN-PallaviNeural",
        "male": "ta-IN-ValluvarNeural"
    },
    "kn": {
        "female": "kn-IN-SapnaNeural",
        "male": "kn-IN-GaganNeural"
    },
    "ml": {
        "female": "ml-IN-SobhanaNeural",
        "male": "ml-IN-MidhunNeural"
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

def call_gemini_tts(text: str, voice_name: str) -> Optional[bytes]:
    """
    Generates realistic speech audio using Gemini 3.1 Flash TTS Preview model.
    Converts raw L16 PCM audio response to standard WAV format.
    """
    if not GEMINI_API_KEY:
        print("GEMINI_API_KEY is not configured in .env file.")
        return None

    url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-tts-preview:generateContent?key={GEMINI_API_KEY}"
    headers = {"Content-Type": "application/json"}

    prompt = f"Read the following text aloud with natural pronunciation. Do not add any extra words. Text: {text}"

    payload = {
        "contents": [{"parts": [{"text": prompt}]}],
        "generationConfig": {
            "responseModalities": ["AUDIO"],
            "speechConfig": {
                "voiceConfig": {
                    "prebuiltVoiceConfig": {
                        "voiceName": voice_name
                    }
                }
            }
        }
    }

    try:
        response = requests.post(url, headers=headers, json=payload, timeout=12)
        if response.status_code != 200:
            print(f"Gemini TTS Warning: {response.status_code} - {response.text}")
            return None

        res_data = response.json()
        parts = res_data["candidates"][0]["content"]["parts"]

        for part in parts:
            if "inlineData" in part:
                mime_type = part["inlineData"]["mimeType"]
                base64_data = part["inlineData"]["data"]

                if "audio/l16" in mime_type.lower():
                    raw_pcm_bytes = base64.b64decode(base64_data)
                    audio_arr = np.frombuffer(raw_pcm_bytes, dtype=np.int16)
                    
                    wav_io = io.BytesIO()
                    sf.write(wav_io, audio_arr, 24000, format="WAV", subtype="PCM_16")
                    wav_io.seek(0)
                    return wav_io.read()
                
        return None
    except Exception as e:
        print(f"Exception calling Gemini TTS: {e}")
        return None

async def call_edge_tts_fallback(text: str, lang_key: str, gender: str) -> Optional[bytes]:
    """
    Fallback method: Generates highly natural speech using Microsoft Edge Neural TTS
    with optimized rate and pitch offsets to eliminate the robotic effect.
    """
    print(f"Falling back to Edge TTS for language '{lang_key}', voice '{gender}'...")
    
    mapped_gender = "female"
    if gender in ["Puck", "Charon", "Fenrir", "male"]:
        mapped_gender = "male"

    voice_name = EDGE_VOICE_MAPPING.get(lang_key, {}).get(mapped_gender)
    if not voice_name:
        voice_name = EDGE_VOICE_MAPPING["en"]["female"]

    rate_val = "-6%" if mapped_gender == "female" else "-8%"
    pitch_val = "+8Hz" if mapped_gender == "female" else "+2Hz"

    try:
        communicate = edge_tts.Communicate(text, voice_name, rate=rate_val, pitch=pitch_val)
        audio_data = io.BytesIO()
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_data.write(chunk["data"])
        
        audio_data.seek(0)
        return audio_data.read()
    except Exception as e:
        print(f"Edge TTS fallback failed: {e}")
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
    
    if "te" in lang or "tenglish" in lang:
        system_prompt = (
            "You are Delulu, a warm, highly empathetic, and emotionally supportive AI companion and best friend. "
            "You listen with deep care, validate their feelings, and respond like a sweet, loving, and understanding girl. "
            "Respond in casual WhatsApp-style conversation (1-2 sentences). "
            "Since the language is Telugu, you must output a JSON response containing two fields:\n"
            "1. 'display_text': The response written in Tenglish (Telugu words in Roman/English script). e.g., 'Ayyyo, em parvaledu. Nenu unnanu ga.'\n"
            "2. 'tts_text': The exact same response written in native Telugu script characters. e.g., 'అయ్యో, ఏం పర్వాలేదు. నేను ఉన్నాను గా.'\n"
            "Never use English translations in either field. Keep it purely Telugu/Tenglish. "
            "Example JSON: {\"display_text\": \"Baadhapadaku na bangaram, nenu eppudu nee thode unnanu.\", \"tts_text\": \"బాధపడకు నా బంగారం, నేను ఎప్పుడు నీ తోడే ఉన్నాను.\"}"
        )
    elif "hi" in lang:
        system_prompt = (
            "You are Delulu, a warm, empathetic AI best friend and emotional support companion. "
            "Respond in natural Hindi (1-2 sentences). Output JSON containing:\n"
            "1. 'display_text': casual Hindi or Hinglish.\n"
            "2. 'tts_text': Native Devanagari Hindi script for TTS reading.\n"
            "Example: {\"display_text\": \"Koi baat nahi yaar, main hoon na tumhare saath.\", \"tts_text\": \"कोई बात नहीं यार, मैं हूँ ना तुम्हारे साथ।\"}"
        )
    else:
        system_prompt = (
            "You are Delulu, a warm, highly empathetic AI best friend and emotional support companion. "
            "Validate their emotions, listen actively, and provide comfort and warmth. "
            "Respond naturally in 1-2 sentences. Output JSON containing:\n"
            "1. 'display_text': casual display text.\n"
            "2. 'tts_text': native script text for the TTS system to read.\n"
            "Example: {\"display_text\": \"Oh, I am so sorry you feel that way. I am right here for you.\", \"tts_text\": \"Oh, I am so sorry you feel that way. I am right here for you.\"}"
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
    Generates speech audio using gemini-3.1-flash-tts-preview as primary.
    If the 3 RPM limit is reached, it falls back to edge-tts with optimized rate/pitch offsets.
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

    selected_voice = payload.gender or "Aoede"
    if selected_voice not in VALID_VOICES:
        selected_voice = "Aoede" if "female" in selected_voice.lower() else "Puck"

    # Step 1: Attempt gemini-3.1-flash-tts-preview (highly natural native VITS)
    print(f"Attempting Gemini 3.1 TTS with voice '{selected_voice}'...")
    wav_bytes = call_gemini_tts(payload.text, selected_voice)

    # Step 2: Fallback to customized edge-tts if API rejected it
    if not wav_bytes:
        print("Gemini 3.1 TTS unavailable. Swapping to custom Edge-TTS fallback.")
        wav_bytes = await call_edge_tts_fallback(payload.text, lang_key, selected_voice)

    if not wav_bytes:
        raise HTTPException(status_code=500, detail="Speech generation failed on all engines.")

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
