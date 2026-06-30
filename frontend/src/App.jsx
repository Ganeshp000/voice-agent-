import React, { useState, useEffect, useRef } from 'react';
import { Mic, Square, Trash2, Download, Sparkles, User, Paperclip, Send, X, Ear, Calendar, Smile, Volume2, Globe } from 'lucide-react';
import './App.css';

const BACKEND_URL = 'http://localhost:8000';

// Crisis keywords for frontend detection
const CRISIS_KEYWORDS = [
  'suicide', 'end my life', 'kill myself', 'chavali', 'die',
  'self-harm', 'self harm', 'want to die', 'wanting to die',
  'hurt myself', 'end it all', 'no reason to live'
];

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
    { value: 'Aoede', label: 'Anjali — Warm Companion' },
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
  const [showCrisisBanner, setShowCrisisBanner] = useState(false);

  // Re-designed view modes: 'home' or 'active'
  const [viewMode, setViewMode] = useState('home');
  const [textInput, setTextInput] = useState('');
  const [activeTab, setActiveTab] = useState('chat'); // 'chat' or 'config'

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
  const audioBuffersRef = useRef([]);

  // --- Helpers ---
  const showToast = (message, isError = false) => {
    setToast({ show: true, message, isError });
    setTimeout(() => setToast(p => ({ ...p, show: false })), 4000);
  };

  const now = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  const detectCrisisKeywords = (text) => {
    const lower = text.toLowerCase();
    return CRISIS_KEYWORDS.some(keyword => lower.includes(keyword));
  };

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
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        setViewMode('active');
        startRecording();
      }
    };
    const ku = (e) => {
      if (e.code === 'Space' && document.activeElement.tagName !== 'SELECT' && document.activeElement.tagName !== 'INPUT') {
        e.preventDefault();
        stopRecording();
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
  }, [messages, isProcessing, viewMode]);

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
    audioBuffersRef.current = [];
    setShowCrisisBanner(false);

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
      audioBuffersRef.current.push(buf);
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
      setStatus({ state: 'speaking', text: 'Speaking…' });
      a.onended = () => { URL.revokeObjectURL(url); activeAudioRef.current = null; setStatus({ state: 'ready', text: 'Connected' }); resolve(); };
      a.onerror = () => { URL.revokeObjectURL(url); activeAudioRef.current = null; setStatus({ state: 'ready', text: 'Connected' }); reject(); };
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
      setViewMode('active');
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
      setStatus({ state: 'listening', text: 'Listening to you…' });
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
      
      await handleTextMessage(transcript);
    } catch (e) {
      setStatus({ state: 'error', text: 'Error' });
      showToast(e.message || 'Something went wrong.', true);
      setIsProcessing(false);
    }
  };

  // --- Text Pipeline ---
  const handleTextMessage = async (text) => {
    if (!text.trim()) return;
    setIsProcessing(true);
    setViewMode('active');
    
    // Add user message locally
    setMessages(p => [...p, { role: 'user', text: text, time: now() }]);
    
    if (detectCrisisKeywords(text)) {
      setShowCrisisBanner(true);
    }

    try {
      setStatus({ state: 'processing', text: 'Thinking…' });
      const chat = await fetchChat(text);
      setMessages(p => [...p, { role: 'assistant', text: chat.display_text, time: now() }]);

      if (detectCrisisKeywords(chat.display_text)) {
        setShowCrisisBanner(true);
      }

      setStatus({ state: 'speaking', text: 'Speaking…' });
      const buf = await fetchSpeak(chat.tts_text);
      audioBuffersRef.current.push(buf);
      await playBuffer(buf);
      setStatus({ state: 'ready', text: 'Connected' });
    } catch (e) {
      setStatus({ state: 'error', text: 'Error' });
      showToast(e.message || 'Something went wrong.', true);
    } finally {
      setIsProcessing(false);
    }
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
    setMessages([]); historyRef.current = []; audioBuffersRef.current = []; stopAudio();
    setShowCrisisBanner(false);
    showToast('Conversation cleared'); greet();
  };

  // --- Download Conversation Audio ---
  const downloadConversation = () => {
    if (audioBuffersRef.current.length === 0) {
      showToast('No voicemail to download yet.', true);
      return;
    }

    const combinedBlob = new Blob(audioBuffersRef.current, { type: 'audio/wav' });
    const url = URL.createObjectURL(combinedBlob);
    const dateStr = new Date().toISOString().slice(0, 10);
    const timeStr = new Date().toLocaleTimeString('en', { hour12: false }).replace(/:/g, '-');
    const filename = `delulu-voicemail-${dateStr}-${timeStr}.wav`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    showToast('Voicemail saved!');
  };

  // Quick Action Triggers
  const handleQuickAction = (action) => {
    if (action === 'voice') {
      setViewMode('active');
      startRecording();
    } else if (action === 'listen') {
      setViewMode('active');
      greet();
    } else if (action === 'checkin') {
      handleTextMessage('Let us do my daily check-in. Tell me how I can express my day.');
    }
  };

  // --- Render ---
  return (
    <div className={`app-container ${viewMode}-view`}>
      {/* ===== Crisis Helpline Banner ===== */}
      {showCrisisBanner && (
        <div className="crisis-banner" id="crisis-helpline-banner">
          <div className="crisis-banner-inner">
            <span className="crisis-icon">🆘</span>
            <div className="crisis-text">
              <strong>If you or someone you know needs help:</strong>
              <span className="crisis-number">KIRAN Helpline: <a href="tel:18005990019">1800-599-0019</a> (24/7 Free)</span>
            </div>
            <button className="crisis-close" onClick={() => setShowCrisisBanner(false)} aria-label="Close banner">✕</button>
          </div>
        </div>
      )}

      {/* ===== SCREEN 1: Home View ===== */}
      {viewMode === 'home' && (
        <div className="home-screen">
          {/* Top Bar */}
          <header className="home-header">
            <div className="logo-section">
              <span className="monogram">DR</span>
              <span className="app-title">Delulu</span>
            </div>
            
            <div className="header-actions">
              {/* Elegant pill selectors inside config dropdowns */}
              <div className="config-pills">
                <select className="pill-select" value={language} onChange={e => setLanguage(e.target.value)}>
                  <option value="te">Telugu</option>
                  <option value="hi">Hindi</option>
                  <option value="en">English</option>
                  <option value="ta">Tamil</option>
                  <option value="kn">Kannada</option>
                  <option value="ml">Malayalam</option>
                </select>

                <select className="pill-select" value={voice} onChange={e => setVoice(e.target.value)}>
                  {(SPEAKERS[language] || []).map(s => (
                    <option key={s.value} value={s.value}>{s.label.split(' — ')[0]}</option>
                  ))}
                </select>
              </div>

              <button className="icon-circle-btn" onClick={() => setActiveTab(activeTab === 'config' ? 'chat' : 'config')} title="Settings">
                <Sparkles size={18} />
              </button>
              
              <button className="icon-circle-btn" onClick={clearChat} title="Clear Chat">
                <Trash2 size={18} />
              </button>
            </div>
          </header>

          {/* Config Panel (if open) */}
          {activeTab === 'config' && (
            <div className="config-drawer glassmorphic">
              <h3>Preferences</h3>
              <p>Configure your companion voice parameters and download backups.</p>
              <div className="drawer-actions">
                <button className="btn-utility" onClick={downloadConversation}>
                  <Download size={16} /> Voicemail for Delulu
                </button>
              </div>
            </div>
          )}

          {/* Main Hero Title */}
          <main className="home-main">
            <div className="welcome-text-container">
              <h1 className="welcome-title">
                Hello Friend<br />
                <span className="welcome-subtitle">Let's talk it out</span>
              </h1>
              <p className="welcome-tagline">
                Share your thoughts, feel heard, and find comfort in conversation.
              </p>
            </div>

            {/* Quick Action Buttons */}
            <div className="quick-actions-row">
              <button className="pill-action-btn" onClick={() => handleQuickAction('voice')}>
                <Ear size={18} className="action-icon purple" />
                <span>Voice notes</span>
              </button>
              
              <button className="pill-action-btn" onClick={() => handleQuickAction('listen')}>
                <Smile size={18} className="action-icon pink" />
                <span>Just listen</span>
              </button>
              
              <button className="pill-action-btn" onClick={() => handleQuickAction('checkin')}>
                <Calendar size={18} className="action-icon blue" />
                <span>Daily check-in</span>
              </button>
            </div>
          </main>

          {/* Bottom input bar */}
          <footer className="home-footer-input">
            <div className="pill-input-wrapper">
              <button 
                className={`mic-pill-btn ${isRecording ? 'recording' : ''}`}
                onMouseDown={startRecording}
                onMouseUp={stopRecording}
                onMouseLeave={stopRecording}
                onTouchStart={e => { e.preventDefault(); startRecording(); }}
                onTouchEnd={e => { e.preventDefault(); stopRecording(); }}
              >
                <Mic size={20} />
              </button>

              <input 
                type="text" 
                className="pill-text-input" 
                placeholder="Tap to speak or type..." 
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleTextMessage(textInput);
                    setTextInput('');
                  }
                }}
              />

              <button className="input-action-btn" onClick={downloadConversation} title="Voicemail backup">
                <Paperclip size={18} />
              </button>
            </div>
          </footer>
        </div>
      )}

      {/* ===== SCREEN 2: Active Voice View ===== */}
      {viewMode === 'active' && (
        <div className="active-screen">
          {/* Top close bar */}
          <header className="active-header">
            <button className="close-chat-btn" onClick={() => { stopAudio(); stopRecording(); setViewMode('home'); }}>
              <X size={16} />
              <span>Close Chat</span>
            </button>
          </header>

          {/* Center Orb Visualizer */}
          <main className="active-main">
            <div className="orb-container">
              {/* Outer pulsing glows */}
              <div className={`orb-glow glow-1 ${status.state}`} />
              <div className={`orb-glow glow-2 ${status.state}`} />
              
              {/* Main animated gradient blob */}
              <div className={`orb-blob ${status.state}`}>
                <div className="blob-fluid" />
              </div>
            </div>

            {/* Status indicators */}
            <div className="active-status-container">
              <h2 className="status-title">
                {status.state === 'listening' ? 'Listening...' : 
                 status.state === 'speaking' ? 'Delulu is speaking' : 
                 status.state === 'processing' ? 'Thinking...' : 
                 'Delulu is here for you'}
              </h2>
              <p className="status-subtitle">
                {status.state === 'listening' ? 'Release space or button to send' : 
                 status.state === 'speaking' ? 'Tap Close to go back' : 
                 'I am listening to your heart'}
              </p>
            </div>

            {/* Waveform visualizer (subtle bar display below status) */}
            <div className="waveform-horizontal" style={{ opacity: isRecording ? 1 : 0 }}>
              {waveHeights.slice(10, 30).map((h, i) => (
                <div key={i} className="wave-line" style={{ height: `${h}px` }} />
              ))}
            </div>

            {/* Chat Transcript Snippet (last response) */}
            {messages.length > 0 && (
              <div className="active-transcript-snippet">
                <div className="transcript-box">
                  <p className="transcript-sender">Delulu</p>
                  <p className="transcript-text">
                    {messages[messages.length - 1].role === 'assistant' 
                      ? messages[messages.length - 1].text 
                      : (messages[messages.length - 2] ? messages[messages.length - 2].text : 'Listening to your voice...')}
                  </p>
                </div>
              </div>
            )}
          </main>

          {/* Bottom input bar */}
          <footer className="active-footer-input">
            <div className="pill-input-wrapper">
              <input 
                type="text" 
                className="pill-text-input" 
                placeholder="Write instead..." 
                value={textInput}
                onChange={e => setTextInput(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    handleTextMessage(textInput);
                    setTextInput('');
                  }
                }}
              />
              <button className="send-arrow-btn" onClick={() => { handleTextMessage(textInput); setTextInput(''); }}>
                <Send size={18} />
              </button>
            </div>
          </footer>
        </div>
      )}

      {/* ===== Toast ===== */}
      <div className={`toast-notification ${toast.show ? 'visible' : ''} ${toast.isError ? 'error' : ''}`}>
        {toast.message}
      </div>
    </div>
  );
}
