import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2, Heart, Volume2, ShieldAlert } from 'lucide-react';
import './App.css';

const BACKEND_URL = 'http://localhost:8000';

// Mapping prebuilt Gemini voices to language-appropriate supportive styles
const SPEAKERS = {
  te: [
    { value: 'Aoede', label: 'Lalitha (Warm Companion)' },
    { value: 'Kore', label: 'Ananya (Soft Listener)' },
    { value: 'Puck', label: 'Prakash (Energetic Friend)' },
    { value: 'Charon', label: 'Kartik (Deep/Comforting)' },
    { value: 'Fenrir', label: 'Siddharth (Crisp Brother)' }
  ],
  hi: [
    { value: 'Aoede', label: 'Divya (Warm Companion)' },
    { value: 'Kore', label: 'Kriti (Soft Listener)' },
    { value: 'Puck', label: 'Rohit (Energetic Friend)' },
    { value: 'Charon', label: 'Aarav (Deep/Comforting)' },
    { value: 'Fenrir', label: 'Kabir (Crisp Brother)' }
  ],
  en: [
    { value: 'Aoede', label: 'Mary (Warm Companion)' },
    { value: 'Kore', label: 'Sarah (Soft Listener)' },
    { value: 'Puck', label: 'James (Energetic Friend)' },
    { value: 'Charon', label: 'David (Deep/Comforting)' },
    { value: 'Fenrir', label: 'John (Crisp Brother)' }
  ],
  ta: [
    { value: 'Aoede', label: 'Kavitha (Warm Companion)' },
    { value: 'Kore', label: 'Meera (Soft Listener)' },
    { value: 'Puck', label: 'Valluvar (Energetic Friend)' },
    { value: 'Charon', label: 'Arjun (Deep/Comforting)' },
    { value: 'Fenrir', label: 'Sanjay (Crisp Brother)' }
  ],
  kn: [
    { value: 'Aoede', label: 'Anu (Warm Companion)' },
    { value: 'Kore', label: 'Aditi (Soft Listener)' },
    { value: 'Puck', label: 'Gagan (Energetic Friend)' },
    { value: 'Charon', label: 'Rohan (Deep/Comforting)' },
    { value: 'Fenrir', label: 'Vikram (Crisp Brother)' }
  ],
  ml: [
    { value: 'Aoede', label: 'Sobhana (Warm Companion)' },
    { value: 'Kore', label: 'Rimi (Soft Listener)' },
    { value: 'Puck', label: 'Midhun (Energetic Friend)' },
    { value: 'Charon', label: 'Rahul (Deep/Comforting)' },
    { value: 'Fenrir', label: 'Hari (Crisp Brother)' }
  ]
};

export default function App() {
  const [language, setLanguage] = useState('te');
  const [voice, setVoice] = useState('Aoede'); 
  const [status, setStatus] = useState({ state: 'processing', text: 'Connecting to server...' });
  const [messages, setMessages] = useState([]);
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [toast, setToast] = useState({ show: false, message: '', isError: false });
  const [waveHeights, setWaveHeights] = useState(new Array(40).fill(3));

  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);
  const audioContextRef = useRef(null);
  const analyserRef = useRef(null);
  const animationFrameRef = useRef(null);
  const activeAudioElementRef = useRef(null);
  const conversationHistoryRef = useRef([]);
  const welcomeAudioDataRef = useRef(null);
  const welcomeSpeechTriggeredRef = useRef(false);
  const chatBottomRef = useRef(null);
  const welcomeRequestSeqRef = useRef(0);

  const showToast = (message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => {
      setToast(prev => ({ ...prev, show: false }));
    }, 4000);
  };

  const updateStatus = (state, text) => {
    setStatus({ state, text });
  };

  useEffect(() => {
    const list = SPEAKERS[language] || [];
    if (list.length > 0) {
      const hasVoice = list.some(v => v.value === voice);
      if (!hasVoice) {
        setVoice(list[0].value);
      }
    }
  }, [language]);

  useEffect(() => {
    checkConnection();
    
    const handleKeyDown = (e) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        startRecording();
      }
    };
    
    const handleKeyUp = (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault();
        stopRecording();
      }
    };

    const handleBodyClick = async () => {
      if (!welcomeSpeechTriggeredRef.current && welcomeAudioDataRef.current) {
        try {
          await playSoundBuffer(welcomeAudioDataRef.current);
          welcomeSpeechTriggeredRef.current = true;
          updateStatus('ready', 'Connected to local server');
        } catch (e) {
          console.error('Bypass autoplay block failed:', e);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    document.body.addEventListener('click', handleBodyClick);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      document.body.removeEventListener('click', handleBodyClick);
      stopAudioPlayback();
    };
  }, []);

  useEffect(() => {
    if (status.state !== 'processing' || messages.length === 0) {
      const timer = setTimeout(() => {
        triggerWelcomeGreeting();
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [language, voice]);

  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  const checkConnection = async () => {
    updateStatus('processing', 'Connecting to backend...');
    try {
      const response = await fetch(`${BACKEND_URL}/docs`, { method: 'HEAD' });
      if (response.ok) {
        updateStatus('ready', 'Connected to local server');
        triggerWelcomeGreeting();
      } else {
        throw new Error();
      }
    } catch (err) {
      updateStatus('error', 'Server offline (port 8000)');
      showToast('FastAPI backend seems offline or unreachable.', true);
    }
  };

  const triggerWelcomeGreeting = async () => {
    const currentSeq = ++welcomeRequestSeqRef.current;
    
    welcomeSpeechTriggeredRef.current = false;
    welcomeAudioDataRef.current = null;
    setMessages([]);
    conversationHistoryRef.current = [];

    try {
      const response = await fetch(`${BACKEND_URL}/greet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, gender: voice })
      });

      if (!response.ok) throw new Error();
      if (currentSeq !== welcomeRequestSeqRef.current) return;

      const data = await response.json();
      setMessages([{ role: 'assistant', text: data.display_text, time: getCurrentTime() }]);

      const audioBuffer = await postSpeak(data.tts_text);
      if (currentSeq !== welcomeRequestSeqRef.current) return;

      welcomeAudioDataRef.current = audioBuffer;

      await playSoundBuffer(audioBuffer);
      welcomeSpeechTriggeredRef.current = true;
      updateStatus('ready', 'Connected to local server');
    } catch (e) {
      console.warn('Autoplay blocked:', e);
      updateStatus('ready', 'Click anywhere to enable voice agent audio');
      showToast('Click anywhere on screen to enable sound!');
    }
  };

  const getCurrentTime = () => {
    return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const playSoundBuffer = (arrayBuffer) => {
    return new Promise((resolve, reject) => {
      try {
        stopAudioPlayback();

        const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
        const blobUrl = URL.createObjectURL(blob);

        const audio = new Audio(blobUrl);
        activeAudioElementRef.current = audio;

        audio.onended = () => {
          URL.revokeObjectURL(blobUrl);
          activeAudioElementRef.current = null;
          resolve();
        };

        audio.onerror = () => {
          URL.revokeObjectURL(blobUrl);
          activeAudioElementRef.current = null;
          reject(new Error('Audio playback failed'));
        };

        const playPromise = audio.play();
        if (playPromise !== undefined) {
          playPromise.then(() => {}).catch(err => reject(err));
        }
      } catch (err) {
        reject(err);
      }
    });
  };

  const stopAudioPlayback = () => {
    if (activeAudioElementRef.current) {
      try {
        activeAudioElementRef.current.pause();
        activeAudioElementRef.current.currentTime = 0;
      } catch (e) {}
      activeAudioElementRef.current = null;
    }
    updateStatus('ready', 'Connected to local server');
  };

  const startRecording = async () => {
    if (isRecording || isProcessing) return;
    stopAudioPlayback();

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true }
      });

      setIsRecording(true);
      audioChunksRef.current = [];

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const source = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 128;
      source.connect(analyserRef.current);
      startVisualizerLoop();

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          audioChunksRef.current.push(e.data);
        }
      };

      recorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        stopVisualizerLoop();

        if (audioChunksRef.current.length === 0) return;

        const blob = new Blob(audioChunksRef.current, { type: mimeType });
        if (blob.size < 4000) {
          updateStatus('ready', 'Connected to local server');
          showToast('Hold the button longer to speak');
          return;
        }

        await executeVoicePipeline(blob);
      };

      recorder.start(100);
      updateStatus('listening', 'Mic Active');
    } catch (err) {
      console.error(err);
      setIsRecording(false);
      updateStatus('error', 'Microphone blocked');
      showToast('Microphone permissions are required.', true);
    }
  };

  const stopRecording = () => {
    if (!isRecording || !mediaRecorderRef.current) return;
    setIsRecording(false);
    mediaRecorderRef.current.stop();
  };

  const startVisualizerLoop = () => {
    const data = new Uint8Array(analyserRef.current.frequencyBinCount);
    
    const loop = () => {
      animationFrameRef.current = requestAnimationFrame(loop);
      analyserRef.current.getByteFrequencyData(data);
      
      const newHeights = waveHeights.map((_, idx) => {
        const dataIdx = Math.floor((idx / 40) * data.length);
        const value = data[dataIdx] || 0;
        return Math.max(3, (value / 255) * 32);
      });
      setWaveHeights(newHeights);
    };
    loop();
  };

  const stopVisualizerLoop = () => {
    cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => {});
      audioContextRef.current = null;
    }
    setWaveHeights(new Array(40).fill(3));
  };

  const executeVoicePipeline = async (audioBlob) => {
    setIsProcessing(true);
    updateStatus('processing', 'Transcribing spoken words...');

    try {
      const transcript = await postTranscribe(audioBlob);
      if (!transcript.trim()) {
        updateStatus('ready', 'Connected to local server');
        showToast('Transcription was empty. Try again.');
        setIsProcessing(false);
        return;
      }

      setMessages(prev => [...prev, { role: 'user', text: transcript, time: getCurrentTime() }]);

      updateStatus('processing', 'Generating response...');
      const chatRes = await postChat(transcript);

      setMessages(prev => [...prev, { role: 'assistant', text: chatRes.display_text, time: getCurrentTime() }]);

      updateStatus('speaking', 'Synthesizing voice...');
      const audioBuffer = await postSpeak(chatRes.tts_text);

      updateStatus('speaking', 'Speaking...');
      await playSoundBuffer(audioBuffer);
      updateStatus('ready', 'Connected to local server');

    } catch (err) {
      console.error(err);
      updateStatus('error', 'Inference failed');
      showToast(err.message || 'Error communicating with backend.', true);
    } finally {
      setIsProcessing(false);
    }
  };

  const postTranscribe = async (audioBlob) => {
    const fd = new FormData();
    fd.append('file', audioBlob, 'speech.webm');

    const res = await fetch(`${BACKEND_URL}/transcribe`, { method: 'POST', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'STT Endpoint failed');
    }

    const data = await res.json();
    
    if (data.language) {
      const code = data.language.toLowerCase().trim();
      const languageMap = {
        te: 'te', telugu: 'te',
        hi: 'hi', hindi: 'hi',
        en: 'en', english: 'en',
        ta: 'ta', tamil: 'ta',
        kn: 'kn', kannada: 'kn',
        ml: 'ml', malayalam: 'ml'
      };
      const mapped = languageMap[code];
      if (mapped && language !== mapped) {
        setLanguage(mapped);
        showToast(`Switched language: ${mapped.toUpperCase()}`);
      }
    }

    return data.transcript;
  };

  const postChat = async (userText) => {
    const res = await fetch(`${BACKEND_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: userText,
        language,
        history: conversationHistoryRef.current
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'LLM Endpoint failed');
    }

    const data = await res.json();
    conversationHistoryRef.current.push({ role: 'user', content: userText });
    conversationHistoryRef.current.push({ role: 'assistant', content: data.display_text });

    return data;
  };

  const postSpeak = async (speakText) => {
    const res = await fetch(`${BACKEND_URL}/speak`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: speakText, language, gender: voice })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.detail || 'TTS Endpoint failed');
    }

    return await res.arrayBuffer();
  };

  const clearChat = () => {
    setMessages([]);
    conversationHistoryRef.current = [];
    stopAudioPlayback();
    showToast('Conversation cleared.');
    triggerWelcomeGreeting();
  };

  return (
    <div className="vox-app-container">
      {/* Background Mesh */}
      <div className="bg-mesh">
        <div className="orb"></div>
        <div className="orb"></div>
      </div>

      {/* Header */}
      <header className="vox-header">
        <div className="logo-row">
          <div className="logo-badge">💖</div>
          <h1 className="logo-title">Delulu</h1>
        </div>
        <p className="logo-tagline">Your Emotional Support Companion & Best Friend</p>
      </header>

      {/* Configuration Card */}
      <div className="config-card">
        <div className="config-grid">
          <div className="field-group">
            <label>
              <Globe className="w-3.5 h-3.5" /> Language
            </label>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value)}
            >
              <option value="te">Telugu (Tenglish)</option>
              <option value="hi">Hindi</option>
              <option value="en">English</option>
              <option value="ta">Tamil</option>
              <option value="kn">Kannada</option>
              <option value="ml">Malayalam</option>
            </select>
          </div>
          
          <div className="field-group">
            <label>
              <Volume2 className="w-3.5 h-3.5" /> Companion Personality
            </label>
            <select
              value={voice}
              onChange={(e) => setVoice(e.target.value)}
            >
              {(SPEAKERS[language] || []).map((spk) => (
                <option key={spk.value} value={spk.value}>
                  {spk.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Status Connection Indicator */}
      <div className="status-badge">
        <span className={`status-dot ${status.state}`} />
        <span>{status.text}</span>
      </div>

      {/* Interactive visualizer wave */}
      <div className="waveform-box" style={{ opacity: isRecording ? 1 : 0 }}>
        {waveHeights.map((h, i) => (
          <div
            key={i}
            className="vis-bar"
            style={{
              height: `${h}px`,
              background: h > 20 ? '#f43f5e' : h > 10 ? '#8b5cf6' : '#ec4899'
            }}
          />
        ))}
      </div>

      {/* Conversation Chat panel */}
      <div className="conversation-panel">
        {messages.length === 0 ? (
          <div className="empty-placeholder">
            <span className="icon">💖</span>
            <h3>Delulu is listening</h3>
            <p>Click anywhere on screen to enable sound permissions, then hold down the spacebar or mic button to talk about your day.</p>
          </div>
        ) : (
          messages.map((msg, i) => (
            <div key={i} className={`msg-bubble ${msg.role === 'user' ? 'user' : 'assistant'}`}>
              <div className="msg-avatar">
                {msg.role === 'user' ? '👤' : '💖'}
              </div>
              <div className="msg-text-wrapper">
                <div className="msg-content">
                  {msg.text}
                </div>
                <span className="msg-timestamp">
                  {msg.time}
                </span>
              </div>
            </div>
          ))
        )}

        {isProcessing && (
          <div className="msg-bubble assistant">
            <div className="msg-avatar">💖</div>
            <div className="msg-content">
              <div className="typing-box">
                <span style={{ animationDelay: '0s' }} />
                <span style={{ animationDelay: '0.15s' }} />
                <span style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={chatBottomRef} />
      </div>

      {/* Speech mic controls */}
      <div className="controls-panel">
        <div className={`mic-outer ${isRecording ? 'recording' : ''}`}>
          <div className="mic-ring" />
          <button
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={stopRecording}
            onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
            onTouchEnd={(e) => { e.preventDefault(); stopRecording(); }}
            className="mic-btn"
          >
            <Mic />
          </button>
        </div>
        
        <span className={`ptt-hint ${isRecording ? 'listening' : ''}`}>
          {isRecording ? 'Listening to you...' : 'Hold Mic to Speak (Spacebar)'}
        </span>

        <div className="btn-row">
          <button onClick={stopAudioPlayback} className="secondary-btn">
            ⏹ Stop Sound
          </button>
          <button onClick={clearChat} className="secondary-btn">
            <Trash2 className="w-3.5 h-3.5" /> Clear Chat
          </button>
        </div>
      </div>

      {/* Notifications */}
      <div className={`toast ${toast.show ? 'show' : ''} ${toast.isError ? 'error' : ''}`}>
        {toast.message}
      </div>
    </div>
  );
}
