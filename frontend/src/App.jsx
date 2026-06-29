import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2, Volume2 } from 'lucide-react';
import './App.css';

const BACKEND_URL = 'http://localhost:8000';

const SPEAKERS = {
  te: [
    { value: 'Aoede', label: 'Lalitha — Warm Companion' },
    { value: 'Kore', label: 'Ananya — Soft Listener' },
    { value: 'Puck', label: 'Prakash — Energetic Friend' },
    { value: 'Charon', label: 'Kartik — Deep & Comforting' },
    { value: 'Fenrir', label: 'Siddharth — Crisp Brother' }
  ],
  hi: [
    { value: 'Aoede', label: 'Divya — Warm Companion' },
    { value: 'Kore', label: 'Kriti — Soft Listener' },
    { value: 'Puck', label: 'Rohit — Energetic Friend' },
    { value: 'Charon', label: 'Aarav — Deep & Comforting' },
    { value: 'Fenrir', label: 'Kabir — Crisp Brother' }
  ],
  en: [
    { value: 'Aoede', label: 'Mary — Warm Companion' },
    { value: 'Kore', label: 'Sarah — Soft Listener' },
    { value: 'Puck', label: 'James — Energetic Friend' },
    { value: 'Charon', label: 'David — Deep & Comforting' },
    { value: 'Fenrir', label: 'John — Crisp Brother' }
  ],
  ta: [
    { value: 'Aoede', label: 'Kavitha — Warm Companion' },
    { value: 'Kore', label: 'Meera — Soft Listener' },
    { value: 'Puck', label: 'Valluvar — Energetic Friend' },
    { value: 'Charon', label: 'Arjun — Deep & Comforting' },
    { value: 'Fenrir', label: 'Sanjay — Crisp Brother' }
  ],
  kn: [
    { value: 'Aoede', label: 'Anu — Warm Companion' },
    { value: 'Kore', label: 'Aditi — Soft Listener' },
    { value: 'Puck', label: 'Gagan — Energetic Friend' },
    { value: 'Charon', label: 'Rohan — Deep & Comforting' },
    { value: 'Fenrir', label: 'Vikram — Crisp Brother' }
  ],
  ml: [
    { value: 'Aoede', label: 'Sobhana — Warm Companion' },
    { value: 'Kore', label: 'Rimi — Soft Listener' },
    { value: 'Puck', label: 'Midhun — Energetic Friend' },
    { value: 'Charon', label: 'Rahul — Deep & Comforting' },
    { value: 'Fenrir', label: 'Hari — Crisp Brother' }
  ]
};

const LANG_LABELS = {
  te: 'Telugu', hi: 'Hindi', en: 'English',
  ta: 'Tamil', kn: 'Kannada', ml: 'Malayalam'
};

export default function App() {
  const [language, setLanguage] = useState('te');
  const [voice, setVoice] = useState('Aoede');
  const [status, setStatus] = useState({ state: 'processing', text: 'Connecting…' });
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
  const activeAudioRef = useRef(null);
  const historyRef = useRef([]);
  const welcomeAudioRef = useRef(null);
  const welcomeTriggeredRef = useRef(false);
  const chatEndRef = useRef(null);
  const seqRef = useRef(0);

  // --- Helpers ---
  const showToast = (message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => setToast(p => ({ ...p, show: false })), 4000);
  };

  const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  // --- Effects ---
  useEffect(() => {
    const list = SPEAKERS[language] || [];
    if (list.length > 0 && !list.some(v => v.value === voice)) {
      setVoice(list[0].value);
    }
  }, [language]);

  useEffect(() => {
    checkConnection();

    const kd = (e) => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault(); startRecording();
      }
    };
    const ku = (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'SELECT') {
        e.preventDefault(); stopRecording();
      }
    };
    const bodyClick = async () => {
      if (!welcomeTriggeredRef.current && welcomeAudioRef.current) {
        try {
          await playBuffer(welcomeAudioRef.current);
          welcomeTriggeredRef.current = true;
          setStatus({ state: 'ready', text: 'Connected' });
        } catch (_) {}
      }
    };

    window.addEventListener('keydown', kd);
    window.addEventListener('keyup', ku);
    document.body.addEventListener('click', bodyClick);
    return () => {
      window.removeEventListener('keydown', kd);
      window.removeEventListener('keyup', ku);
      document.body.removeEventListener('click', bodyClick);
      stopAudio();
    };
  }, []);

  useEffect(() => {
    if (status.state !== 'processing' || messages.length === 0) {
      const t = setTimeout(() => greet(), 150);
      return () => clearTimeout(t);
    }
  }, [language, voice]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isProcessing]);

  // --- Connection ---
  const checkConnection = async () => {
    setStatus({ state: 'processing', text: 'Connecting…' });
    try {
      const r = await fetch(`${BACKEND_URL}/docs`, { method: 'HEAD' });
      if (r.ok) { setStatus({ state: 'ready', text: 'Connected' }); greet(); }
      else throw new Error();
    } catch {
      setStatus({ state: 'error', text: 'Server offline' });
      showToast('Backend server is unreachable.', true);
    }
  };

  // --- Greeting ---
  const greet = async () => {
    const seq = ++seqRef.current;
    welcomeTriggeredRef.current = false;
    welcomeAudioRef.current = null;
    setMessages([]);
    historyRef.current = [];

    try {
      const r = await fetch(`${BACKEND_URL}/greet`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ language, gender: voice })
      });
      if (!r.ok) throw new Error();
      if (seq !== seqRef.current) return;

      const d = await r.json();
      setMessages([{ role: 'assistant', text: d.display_text, time: now() }]);

      const buf = await fetchSpeak(d.tts_text);
      if (seq !== seqRef.current) return;

      welcomeAudioRef.current = buf;
      await playBuffer(buf);
      welcomeTriggeredRef.current = true;
      setStatus({ state: 'ready', text: 'Connected' });
    } catch {
      setStatus({ state: 'ready', text: 'Click anywhere to enable audio' });
    }
  };

  // --- Audio Playback ---
  const playBuffer = (arrayBuffer) => new Promise((resolve, reject) => {
    try {
      stopAudio();
      const blob = new Blob([arrayBuffer], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const a = new Audio(url);
      activeAudioRef.current = a;
      a.onended = () => { URL.revokeObjectURL(url); activeAudioRef.current = null; resolve(); };
      a.onerror = () => { URL.revokeObjectURL(url); activeAudioRef.current = null; reject(); };
      a.play().catch(reject);
    } catch (e) { reject(e); }
  });

  const stopAudio = () => {
    if (activeAudioRef.current) {
      try { activeAudioRef.current.pause(); activeAudioRef.current.currentTime = 0; } catch (_) {}
      activeAudioRef.current = null;
    }
    setStatus({ state: 'ready', text: 'Connected' });
  };

  // --- Recording ---
  const startRecording = async () => {
    if (isRecording || isProcessing) return;
    stopAudio();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
      setIsRecording(true);
      audioChunksRef.current = [];

      audioContextRef.current = new (window.AudioContext || window.webkitAudioContext)();
      const src = audioContextRef.current.createMediaStreamSource(stream);
      analyserRef.current = audioContextRef.current.createAnalyser();
      analyserRef.current.fftSize = 128;
      src.connect(analyserRef.current);
      visualize();

      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm';
      const rec = new MediaRecorder(stream, { mimeType: mime });
      mediaRecorderRef.current = rec;
      rec.ondataavailable = (e) => { if (e.data.size > 0) audioChunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        stopVisualize();
        if (!audioChunksRef.current.length) return;
        const blob = new Blob(audioChunksRef.current, { type: mime });
        if (blob.size < 4000) { setStatus({ state: 'ready', text: 'Connected' }); showToast('Hold longer to speak'); return; }
        await pipeline(blob);
      };
      rec.start(100);
      setStatus({ state: 'listening', text: 'Listening…' });
    } catch {
      setIsRecording(false);
      setStatus({ state: 'error', text: 'Mic blocked' });
      showToast('Microphone permission required.', true);
    }
  };

  const stopRecording = () => {
    if (!isRecording || !mediaRecorderRef.current) return;
    setIsRecording(false);
    mediaRecorderRef.current.stop();
  };

  const visualize = () => {
    const d = new Uint8Array(analyserRef.current.frequencyBinCount);
    const loop = () => {
      animationFrameRef.current = requestAnimationFrame(loop);
      analyserRef.current.getByteFrequencyData(d);
      setWaveHeights(prev => prev.map((_, i) => Math.max(3, (d[Math.floor((i / 40) * d.length)] || 0) / 255 * 36)));
    };
    loop();
  };

  const stopVisualize = () => {
    cancelAnimationFrame(animationFrameRef.current);
    if (audioContextRef.current) { audioContextRef.current.close().catch(() => {}); audioContextRef.current = null; }
    setWaveHeights(new Array(40).fill(3));
  };

  // --- Voice Pipeline ---
  const pipeline = async (blob) => {
    setIsProcessing(true);
    setStatus({ state: 'processing', text: 'Transcribing…' });
    try {
      const transcript = await fetchTranscribe(blob);
      if (!transcript.trim()) { setStatus({ state: 'ready', text: 'Connected' }); showToast('Could not hear you. Try again.'); setIsProcessing(false); return; }
      setMessages(p => [...p, { role: 'user', text: transcript, time: now() }]);

      setStatus({ state: 'processing', text: 'Thinking…' });
      const chat = await fetchChat(transcript);
      setMessages(p => [...p, { role: 'assistant', text: chat.display_text, time: now() }]);

      setStatus({ state: 'speaking', text: 'Speaking…' });
      const buf = await fetchSpeak(chat.tts_text);
      await playBuffer(buf);
      setStatus({ state: 'ready', text: 'Connected' });
    } catch (e) {
      setStatus({ state: 'error', text: 'Error' });
      showToast(e.message || 'Something went wrong.', true);
    } finally { setIsProcessing(false); }
  };

  // --- API Calls ---
  const fetchTranscribe = async (blob) => {
    const fd = new FormData(); fd.append('file', blob, 'speech.webm');
    const r = await fetch(`${BACKEND_URL}/transcribe`, { method: 'POST', body: fd });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'STT failed');
    const d = await r.json();
    if (d.language) {
      const map = { te: 'te', telugu: 'te', hi: 'hi', hindi: 'hi', en: 'en', english: 'en', ta: 'ta', tamil: 'ta', kn: 'kn', kannada: 'kn', ml: 'ml', malayalam: 'ml' };
      const m = map[d.language.toLowerCase().trim()];
      if (m && language !== m) { setLanguage(m); showToast(`Language: ${LANG_LABELS[m]}`); }
    }
    return d.transcript;
  };

  const fetchChat = async (text) => {
    const r = await fetch(`${BACKEND_URL}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, history: historyRef.current })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'Chat failed');
    const d = await r.json();
    historyRef.current.push({ role: 'user', content: text }, { role: 'assistant', content: d.display_text });
    return d;
  };

  const fetchSpeak = async (text) => {
    const r = await fetch(`${BACKEND_URL}/speak`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language, gender: voice })
    });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).detail || 'TTS failed');
    return r.arrayBuffer();
  };

  const clearChat = () => {
    setMessages([]); historyRef.current = []; stopAudio();
    showToast('Conversation cleared'); greet();
  };

  // --- Render ---
  return (
    <>
      {/* ===== Global Nav (Black Bar) ===== */}
      <nav className="global-nav">
        <div className="global-nav-inner">
          <div className="nav-brand">
            <span className="nav-logo">💖</span>
            <span className="nav-title">Delulu</span>
          </div>
          <div className="nav-actions">
            <div className="nav-status">
              <span className={`nav-status-dot ${status.state}`} />
              <span>{status.text}</span>
            </div>
          </div>
        </div>
      </nav>

      {/* ===== Sub Nav (Frosted Config Bar) ===== */}
      <div className="sub-nav">
        <div className="sub-nav-inner">
          <div className="sub-nav-left">
            <span className="sub-nav-category">Companion</span>

            <div className="apple-select-group">
              <span className="apple-select-label">Language</span>
              <select className="apple-select" value={language} onChange={e => setLanguage(e.target.value)}>
                <option value="te">Telugu</option>
                <option value="hi">Hindi</option>
                <option value="en">English</option>
                <option value="ta">Tamil</option>
                <option value="kn">Kannada</option>
                <option value="ml">Malayalam</option>
              </select>
            </div>
          </div>

          <div className="sub-nav-right">
            <div className="apple-select-group">
              <span className="apple-select-label">Voice</span>
              <select className="apple-select" value={voice} onChange={e => setVoice(e.target.value)}>
                {(SPEAKERS[language] || []).map(s => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>

      {/* ===== Hero Tile (White) ===== */}
      {messages.length === 0 && !isProcessing && (
        <section className="hero-tile">
          <span className="hero-icon">💖</span>
          <h1 className="hero-headline">Delulu</h1>
          <p className="hero-tagline">Your emotional support companion. Speak in your language — Delulu listens, understands, and cares.</p>
          <div className="hero-cta-row">
            <button className="btn-primary" onClick={() => document.body.click()}>
              Get Started
            </button>
            <button className="btn-secondary-pill" onClick={startRecording}>
              <Mic style={{ width: 16, height: 16 }} /> Start Talking
            </button>
          </div>
        </section>
      )}

      {/* ===== Conversation Section (Parchment) ===== */}
      <section className="conversation-section">
        <div className="conversation-container">
          <div className="chat-panel">
            {messages.length === 0 && !isProcessing ? (
              <div className="empty-state">
                <span className="empty-state-icon">🫶</span>
                <h3>Delulu is here for you</h3>
                <p>Click "Get Started" or hold down the spacebar to share what's on your mind. I'm all ears.</p>
              </div>
            ) : (
              <>
                {messages.map((msg, i) => (
                  <div key={i} className={`msg-row ${msg.role}`}>
                    <div className="msg-avatar">
                      {msg.role === 'user' ? '👤' : '💖'}
                    </div>
                    <div className="msg-body">
                      <div className="msg-text">{msg.text}</div>
                      <span className="msg-time">{msg.time}</span>
                    </div>
                  </div>
                ))}

                {isProcessing && (
                  <div className="msg-row assistant">
                    <div className="msg-avatar">💖</div>
                    <div className="msg-body">
                      <div className="msg-text">
                        <div className="typing-dots">
                          <span style={{ animationDelay: '0s' }} />
                          <span style={{ animationDelay: '0.15s' }} />
                          <span style={{ animationDelay: '0.3s' }} />
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
            <div ref={chatEndRef} />
          </div>
        </div>
      </section>

      {/* ===== Controls Section (Dark Tile) ===== */}
      <section className="controls-section">
        {/* Waveform */}
        <div className="waveform-container" style={{ opacity: isRecording ? 1 : 0 }}>
          {waveHeights.map((h, i) => (
            <div key={i} className="wave-bar" style={{ height: `${h}px` }} />
          ))}
        </div>

        {/* Mic */}
        <div className={`mic-wrapper ${isRecording ? 'active' : ''}`}>
          <div className="mic-ring-pulse" />
          <button
            className="mic-button"
            onMouseDown={startRecording}
            onMouseUp={stopRecording}
            onMouseLeave={stopRecording}
            onTouchStart={e => { e.preventDefault(); startRecording(); }}
            onTouchEnd={e => { e.preventDefault(); stopRecording(); }}
          >
            <Mic />
          </button>
        </div>

        <span className={`mic-hint ${isRecording ? 'active' : ''}`}>
          {isRecording ? 'Listening to you…' : 'Hold to speak · Spacebar'}
        </span>

        {/* Utility Buttons */}
        <div className="action-row">
          <button className="btn-dark-utility" onClick={stopAudio}>
            <Square /> Stop
          </button>
          <button className="btn-dark-utility" onClick={clearChat}>
            <Trash2 /> Clear
          </button>
        </div>
      </section>

      {/* ===== Footer ===== */}
      <footer className="app-footer">
        <p className="footer-text">Delulu — Multilingual Emotional Support Companion · Built with Gemini & Edge TTS</p>
      </footer>

      {/* ===== Toast ===== */}
      <div className={`toast-notification ${toast.show ? 'visible' : ''} ${toast.isError ? 'error' : ''}`}>
        {toast.message}
      </div>
    </>
  );
}
