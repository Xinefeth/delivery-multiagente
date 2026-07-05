import React, { useState, useEffect, useRef, useCallback } from 'react';
import { v4 as uuidv4 } from 'uuid';
import { sendSmartMessage, api } from '../services/api';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  isImage?: boolean;
  imageUrl?: string;
}

const QUICK_REPLIES = ['Ver menú', 'Ver mi carrito', 'Estado de mi pedido', 'Hablar con soporte'];

function formatText(text: string): React.ReactNode {
  const parts = text.split(/(\*[^*]+\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('*') && part.endsWith('*')) {
      return <strong key={i}>{part.slice(1, -1)}</strong>;
    }
    return <span key={i}>{part}</span>;
  });
}

export default function ChatbotWidget() {
  const [sessionId] = useState(() => `smart-${uuidv4()}`);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [attachment, setAttachment] = useState<File | null>(null);
  const [attachmentPreview, setAttachmentPreview] = useState<string | null>(null);
  const [contextualQuickReplies, setContextualQuickReplies] = useState<string[]>([]);
  const [confirmedOrderId, setConfirmedOrderId] = useState<string | null>(null);
  const surveyTriggered = useRef(false);
  const driverNotified = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const initialized = useRef(false);

  const addMessage = useCallback((role: 'user' | 'assistant', content: string, extra?: Partial<Message>) => {
    setMessages(prev => [...prev, { id: uuidv4(), role, content, timestamp: new Date(), ...extra }]);
  }, []);

  const send = useCallback(async (text: string, file?: File | null) => {
    if (!text.trim() && !file) return;
    setLoading(true);
    setContextualQuickReplies([]);

    if (file) {
      const url = URL.createObjectURL(file);
      addMessage('user', '', { isImage: true, imageUrl: url });
    } else {
      addMessage('user', text);
    }

    setInput('');
    setAttachment(null);
    setAttachmentPreview(null);

    try {
      const data = await sendSmartMessage(sessionId, text, file || undefined);
      addMessage('assistant', data.message || 'No pude procesar tu solicitud.');
      if (Array.isArray(data.quickReplies) && data.quickReplies.length > 0) {
        setContextualQuickReplies(data.quickReplies);
      }
      // Guardar orderId cuando el pedido es confirmado para hacer polling
      if (data.orderId && !confirmedOrderId) {
        setConfirmedOrderId(data.orderId);
      }
    } catch {
      addMessage('assistant', 'Hubo un error conectando al servidor. Intenta de nuevo.');
    } finally {
      setLoading(false);
    }
  }, [sessionId, addMessage]);

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    send('hola');
  }, [send]);

  // Polling: detecta asignación de repartidor y notifica al cliente automáticamente
  useEffect(() => {
    if (!confirmedOrderId || driverNotified.current) return;
    const interval = setInterval(async () => {
      if (driverNotified.current) return;
      try {
        const { data } = await api.get(`/chat/driver-check/${sessionId}`);
        if (data.assigned && data.message) {
          driverNotified.current = true;
          clearInterval(interval);
          addMessage('assistant', data.message);
        }
      } catch {}
    }, 8000);
    return () => clearInterval(interval);
  }, [confirmedOrderId, sessionId, addMessage]);

  // Polling: detecta entrega y muestra encuesta automáticamente
  useEffect(() => {
    if (!confirmedOrderId || surveyTriggered.current) return;
    const interval = setInterval(async () => {
      if (surveyTriggered.current) return;
      try {
        const { data } = await api.get(`/chat/survey-check/${sessionId}`);
        if (data.survey && data.message) {
          surveyTriggered.current = true;
          clearInterval(interval);
          addMessage('assistant', data.message);
        }
      } catch {
        // silencioso
      }
    }, 8000);
    return () => clearInterval(interval);
  }, [confirmedOrderId, sessionId, addMessage]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAttachment(file);
    setAttachmentPreview(URL.createObjectURL(file));
    e.target.value = '';
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (attachment) {
      send(input, attachment);
    } else {
      send(input);
    }
  };

  return (
    <div className="flex flex-col h-full bg-[#ECE5DD]">
      {/* Header */}
      <div className="bg-[#075E54] text-white px-4 py-3 flex items-center gap-3 shadow-md">
        <div className="w-10 h-10 rounded-full bg-[#25D366] flex items-center justify-center text-lg font-bold">
          T
        </div>
        <div>
          <p className="font-semibold text-sm">El Trujillano</p>
          <p className="text-xs text-green-200">Asistente virtual • En línea</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-3 py-4 space-y-2">
        {messages.map(msg => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[80%] rounded-2xl px-3 py-2 shadow-sm text-sm whitespace-pre-wrap ${
                msg.role === 'user'
                  ? 'bg-[#DCF8C6] text-gray-800 rounded-tr-none'
                  : 'bg-white text-gray-800 rounded-tl-none'
              }`}
            >
              {msg.isImage && msg.imageUrl ? (
                <img src={msg.imageUrl} alt="adjunto" className="rounded-lg max-w-full max-h-48 object-cover" />
              ) : (
                <span>{formatText(msg.content)}</span>
              )}
              <p className={`text-[10px] mt-1 ${msg.role === 'user' ? 'text-green-700 text-right' : 'text-gray-400'}`}>
                {msg.timestamp.toLocaleTimeString('es-PE', { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex justify-start">
            <div className="bg-white rounded-2xl rounded-tl-none px-4 py-3 shadow-sm">
              <div className="flex gap-1 items-center h-4">
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies contextuales (vienen del backend) */}
      {!loading && contextualQuickReplies.length > 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-2">
          {contextualQuickReplies.map(qr => (
            <button
              key={qr}
              onClick={() => send(qr)}
              className="bg-white text-[#075E54] border border-[#075E54] text-xs rounded-full px-3 py-1 hover:bg-[#075E54] hover:text-white transition-colors font-medium"
            >
              {qr}
            </button>
          ))}
        </div>
      )}

      {/* Quick replies estáticos — solo en el saludo inicial */}
      {!loading && messages.length <= 2 && contextualQuickReplies.length === 0 && (
        <div className="px-3 pb-2 flex flex-wrap gap-2">
          {QUICK_REPLIES.map(qr => (
            <button
              key={qr}
              onClick={() => send(qr)}
              className="bg-white text-[#075E54] border border-[#075E54] text-xs rounded-full px-3 py-1 hover:bg-[#075E54] hover:text-white transition-colors"
            >
              {qr}
            </button>
          ))}
        </div>
      )}

      {/* Attachment preview */}
      {attachmentPreview && (
        <div className="px-3 pb-1 flex items-center gap-2">
          <img src={attachmentPreview} alt="preview" className="h-14 w-14 object-cover rounded-lg border border-gray-300" />
          <button onClick={() => { setAttachment(null); setAttachmentPreview(null); }} className="text-red-500 text-xs">
            Quitar
          </button>
        </div>
      )}

      {/* Input bar */}
      <form onSubmit={handleSubmit} className="bg-[#F0F0F0] px-3 py-2 flex items-center gap-2 border-t border-gray-300">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="text-gray-500 hover:text-[#075E54] transition-colors p-1"
          title="Adjuntar imagen"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
          </svg>
        </button>
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />

        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Escribe un mensaje..."
          className="flex-1 rounded-full px-4 py-2 text-sm bg-white border border-gray-300 focus:outline-none focus:border-[#25D366]"
          disabled={loading}
        />

        <button
          type="submit"
          disabled={loading || (!input.trim() && !attachment)}
          className="bg-[#25D366] text-white rounded-full w-9 h-9 flex items-center justify-center hover:bg-[#1da851] disabled:opacity-50 transition-colors"
        >
          <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z" />
          </svg>
        </button>
      </form>
    </div>
  );
}
