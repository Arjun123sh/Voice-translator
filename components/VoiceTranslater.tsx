"use client";

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Mic, MicOff, Volume2, Trash2, AlertCircle, Sparkles } from 'lucide-react';

const LANGS = [
  { code: 'en-US', label: 'English', flag: '🇺🇸' },
  { code: 'hi-IN', label: 'Hindi', flag: '🇮🇳' },
  { code: 'es-ES', label: 'Spanish', flag: '🇪🇸' },
  { code: 'fr-FR', label: 'French', flag: '🇫🇷' },
];

export default function VoiceTranslator() {
  const [listening, setListening] = useState(false);
  const [sourceLang, setSourceLang] = useState('en-US');
  const [targetLang, setTargetLang] = useState('hi-IN');
  const [original, setOriginal] = useState('');
  const [translated, setTranslated] = useState('');
  const [error, setError] = useState('');
  const [isTranslating, setIsTranslating] = useState(false);


  const timeoutRef = useRef(null);
  const controllerRef = useRef(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const isRestartingRef = useRef(false);
  const shouldListenRef = useRef(false);

  useEffect(() => {
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
          recognitionRef.current.onend = null;
        } catch {}
      }
    };
  }, []);

  // Keep recognition.lang in sync when sourceLang changes (do not recreate/start here)
  useEffect(() => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.lang = sourceLang;
      } catch {}
    }
  }, [sourceLang]);

  // Note: recognition creation and start/stop are handled from toggleListening to avoid
  // multiple competing instances and restart races.

  useEffect(() => {
    if (!original.trim()) {
      setTranslated('');
      setIsTranslating(false);
      return;
    }

    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    if (controllerRef.current) controllerRef.current.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    setIsTranslating(true);

    timeoutRef.current = setTimeout(async () => {
      try {
        const res = await fetch('/api/gemini', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: original.trim(), targetLang }),
          signal: controller.signal,
        });

        if (!res.ok) throw new Error(`Translation failed: ${res.status}`);
        const json = await res.json();

        if (json?.translation) {
          setTranslated(json.translation);
          setError('');
        }
      } catch (e) {
        if (e.name !== 'AbortError') {
          console.error('Translation error:', e);
          setError('Translation failed. Please try again.');
        }
      } finally {
        setIsTranslating(false);
      }
    }, 800);

    return () => {
      clearTimeout(timeoutRef.current);
      controller.abort();
      setIsTranslating(false);
    };
  }, [original, targetLang]);

  const toggleListening = useCallback(async () => {
    // If we are currently listening -> stop and prevent auto-restart
    if (listening) {
      shouldListenRef.current = false;
      const recognition = recognitionRef.current;
      if (recognition) {
        try {
          recognition.stop();
        } catch (err) {
          console.warn('Error stopping recognition:', err);
        }
      }
      recognitionRef.current = null;
      setListening(false);

      // stop mic tracks explicitly (best-effort)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stream) {
          stream.getAudioTracks().forEach((track) => track.stop());
        }
      } catch {}

      return;
    }

    // Start listening: check permissions first
    try {
      let permissionStatus: PermissionStatus | undefined;
      try {
        permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });
      } catch {
        // Permission API not available, continue to getUserMedia which will prompt
      }
      if (permissionStatus && permissionStatus.state === 'denied') {
        setError('Microphone access is denied. Please enable it in your browser settings.');
        return;
      }

      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        if (stream) {
          stream.getTracks().forEach((t) => t.stop());
        }
      } catch (err) {
        setError('Microphone permission denied by user.');
        return;
      }

      // Factory to create a recognition instance with safe restart logic
      const createRecognition = () => {
        const SpeechRecognitionImpl: any =
          (window as any).webkitSpeechRecognition || (window as any).SpeechRecognition;
        const rec: any = new SpeechRecognitionImpl();
        rec.continuous = true;
        rec.interimResults = true;
        rec.lang = sourceLang;

        rec.onresult = (event: any) => {
          const transcript = Array.from(event.results).map((r: any) => r[0].transcript).join('');
          setOriginal(transcript);
        };

        rec.onerror = (evt: any) => {
          console.error('Speech recognition error:', evt);
          setError('Speech recognition error occurred');
          setListening(false);
        };

        rec.onend = () => {
          // Only attempt restart when we explicitly want to keep listening
          if (!shouldListenRef.current) return;

          // Ensure we are restarting the current active recognition instance
          setTimeout(() => {
            try {
              const current = recognitionRef.current;
              // If recognitionRef has been replaced, don't restart this old instance
              if (current && current === rec) {
                try {
                  rec.start();
                } catch (err) {
                  // If start fails (service disconnected), recreate & start
                  console.warn('Restart failed, recreating recognition:', err);
                  const newRec = createRecognition();
                  recognitionRef.current = newRec;
                  try {
                    newRec.start();
                  } catch (e2) {
                    console.error('Failed to restart recognition:', e2);
                    setListening(false);
                  }
                }
              }
            } catch (e) {
              console.warn('Error during recognition onend restart logic:', e);
            }
          }, 600);
        };

        return rec;
      };

      shouldListenRef.current = true;
      const rec = createRecognition();
      recognitionRef.current = rec;
      try {
        rec.start();
        setListening(true);
      } catch (err) {
        // If start fails, try recreate once
        console.warn('Initial start failed, trying recreate:', err);
        const rec2 = createRecognition();
        recognitionRef.current = rec2;
        try {
          rec2.start();
          setListening(true);
        } catch (err2) {
          console.error('Failed to start speech recognition:', err2);
          setError('Failed to start listening. Please try again.');
          setListening(false);
        }
      }
    } catch (err) {
      console.error('Error initializing microphone:', err);
      setError('Failed to start listening. Please try again.');
    }
  }, [listening, sourceLang]);

  const stopListening = useCallback(() => {
    const recognition = recognitionRef.current;
    if (recognition) {
      try {
        recognition.stop();
      } catch (e) {
        console.error('Error stopping recognition:', e);
      }
    }
    setListening(false);
  }, []);

  const speakTranslated = useCallback(() => {
    if (!translated.trim()) return;

    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(translated);
    utterance.lang = targetLang;

    const loadAndSpeak = () => {
      const voices = window.speechSynthesis.getVoices();
      const match = voices.find((voice) => voice.lang.startsWith(targetLang.split('-')[0]));
      if (match) utterance.voice = match;
      window.speechSynthesis.speak(utterance);
    };

    if (window.speechSynthesis.getVoices().length === 0) {
      window.speechSynthesis.onvoiceschanged = loadAndSpeak;
    } else {
      loadAndSpeak();
    }

    utterance.onerror = (event) => {
      console.error('Speech synthesis error:', event);
      setError('Speech synthesis failed');
    };
  }, [translated, targetLang]);

  const clearText = useCallback(() => {
    setOriginal('');
    setTranslated('');
    setError('');
    setIsTranslating(false);
  }, []);

  const handleSourceLangChange = useCallback(
    (newLang) => {
      stopListening();
      setSourceLang(newLang);
    },
    [stopListening]
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-indigo-50 via-purple-50 to-pink-50 p-4 md:p-8">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="text-center mb-8 animate-fadeIn">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="relative">
              <Sparkles className="w-10 h-10 text-purple-600" />
              <div className="absolute inset-0 blur-xl bg-purple-400 opacity-50 animate-pulse"></div>
            </div>
            <h1 className="text-5xl md:text-6xl font-bold bg-gradient-to-r from-purple-600 via-pink-600 to-indigo-600 text-transparent bg-clip-text">
              Voice Translator
            </h1>
          </div>
          <p className="text-gray-600 text-lg">Speak naturally, translate instantly</p>
        </div>

        {/* Language Selection Card */}
        <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 mb-6 border border-white/50">
          <div className="grid md:grid-cols-2 gap-6">
            {/* Source Language */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Speak in
              </label>
              <select
                value={sourceLang}
                onChange={(e) => handleSourceLangChange(e.target.value)}
                disabled={listening}
                className="w-full px-6 py-4 bg-gradient-to-r from-purple-50 to-indigo-50 border-2 border-purple-200 rounded-2xl text-lg font-medium text-gray-800 focus:outline-none focus:ring-4 focus:ring-purple-300 focus:border-purple-400 transition-all disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer hover:border-purple-300"
              >
                {LANGS.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.label}
                  </option>
                ))}
              </select>
            </div>

            {/* Target Language */}
            <div className="space-y-2">
              <label className="block text-sm font-semibold text-gray-700 mb-3">
                Translate to
              </label>
              <select
                value={targetLang}
                onChange={(e) => setTargetLang(e.target.value)}
                className="w-full px-6 py-4 bg-gradient-to-r from-pink-50 to-purple-50 border-2 border-pink-200 rounded-2xl text-lg font-medium text-gray-800 focus:outline-none focus:ring-4 focus:ring-pink-300 focus:border-pink-400 transition-all cursor-pointer hover:border-pink-300"
              >
                {LANGS.map((lang) => (
                  <option key={lang.code} value={lang.code}>
                    {lang.flag} {lang.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Error Alert */}
          {error && (
            <div className="mt-6 p-4 bg-red-50 border-2 border-red-200 rounded-2xl flex items-start gap-3 animate-slideDown">
              <AlertCircle className="w-5 h-5 text-red-600 flex-shrink-0 mt-0.5" />
              <p className="text-red-800 flex-1">{error}</p>
              <button
                onClick={() => setError('')}
                className="text-red-400 hover:text-red-600 transition-colors"
              >
                ✕
              </button>
            </div>
          )}

          {/* Control Buttons */}
          <div className="flex flex-wrap gap-4 justify-center mt-8">
            <button
              onClick={toggleListening}
              className={`group relative px-8 py-4 rounded-2xl font-semibold text-lg transition-all duration-300 transform hover:scale-105 active:scale-95 shadow-lg ${
                listening
                  ? 'bg-gradient-to-r from-red-500 to-pink-600 text-white shadow-red-300'
                  : 'bg-gradient-to-r from-purple-600 to-indigo-600 text-white shadow-purple-300 hover:shadow-xl'
              }`}
            >
              <span className="flex items-center gap-3">
                {listening ? (
                  <>
                    <MicOff className="w-6 h-6" />
                    Stop Listening
                  </>
                ) : (
                  <>
                    <Mic className="w-6 h-6" />
                    Start Listening
                  </>
                )}
              </span>
              {listening && (
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-red-400 rounded-full animate-ping"></div>
              )}
            </button>

            <button
              onClick={speakTranslated}
              disabled={!translated.trim() || isTranslating}
              className="px-8 py-4 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-2xl font-semibold text-lg shadow-lg shadow-green-300 transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none hover:shadow-xl"
            >
              <span className="flex items-center gap-3">
                <Volume2 className="w-6 h-6" />
                Speak Translation
              </span>
            </button>

            <button
              onClick={clearText}
              disabled={!original && !translated}
              className="px-8 py-4 bg-white border-2 border-gray-300 text-gray-700 rounded-2xl font-semibold text-lg shadow-lg transition-all duration-300 transform hover:scale-105 active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed disabled:transform-none hover:border-gray-400 hover:shadow-xl"
            >
              <span className="flex items-center gap-3">
                <Trash2 className="w-6 h-6" />
                Clear
              </span>
            </button>
          </div>
        </div>

        {/* Translation Display */}
        <div className="grid lg:grid-cols-2 gap-6">
          {/* Original Text */}
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 border border-white/50 transition-all duration-300 hover:shadow-3xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Original Text</h2>
              {listening && (
                <div className="flex items-center gap-2 px-4 py-2 bg-red-100 rounded-full">
                  <div className="w-3 h-3 bg-red-500 rounded-full animate-pulse"></div>
                  <span className="text-sm font-semibold text-red-700">Recording</span>
                </div>
              )}
            </div>
            <div className="relative min-h-[300px] p-6 bg-gradient-to-br from-purple-50 to-indigo-50 rounded-2xl border-2 border-purple-100">
              <p className="text-gray-800 text-lg leading-relaxed whitespace-pre-wrap">
                {original || (
                  <span className="text-gray-400 italic">
                    Click "Start Listening" and begin speaking...
                  </span>
                )}
              </p>
            </div>
          </div>

          {/* Translated Text */}
          <div className="bg-white/80 backdrop-blur-xl rounded-3xl shadow-2xl p-6 md:p-8 border border-white/50 transition-all duration-300 hover:shadow-3xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-2xl font-bold text-gray-800">Translated Text</h2>
              {isTranslating && (
                <div className="flex items-center gap-2 px-4 py-2 bg-purple-100 rounded-full">
                  <div className="w-3 h-3 border-2 border-purple-600 border-t-transparent rounded-full animate-spin"></div>
                  <span className="text-sm font-semibold text-purple-700">Translating</span>
                </div>
              )}
            </div>
            <div className="relative min-h-[300px] p-6 bg-gradient-to-br from-pink-50 to-purple-50 rounded-2xl border-2 border-pink-100">
              <p className="text-gray-800 text-lg leading-relaxed whitespace-pre-wrap">
                {translated || (
                  <span className="text-gray-400 italic">
                    Translation will appear here...
                  </span>
                )}
              </p>
            </div>
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from {
            opacity: 0;
            transform: translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        @keyframes slideDown {
          from {
            opacity: 0;
            transform: translateY(-10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .animate-fadeIn {
          animation: fadeIn 0.6s ease-out;
        }

        .animate-slideDown {
          animation: slideDown 0.3s ease-out;
        }

        .hover\:shadow-3xl:hover {
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
        }
      `}</style>
    </div>
  );
}