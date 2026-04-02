import React, { useState, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  TextInput, SafeAreaView, FlatList,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// --- API client (subset needed by DiagnosisScreen) ---
const api = {
  async getToken() { return AsyncStorage.getItem('rr_token'); },
  async request(method, path, body) {
    const token = await this.getToken();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const r = await fetch(API + path, {
        method,
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error?.message || 'HTTP ' + r.status);
      return data;
    } catch (err) {
      if (err.name === 'AbortError') throw new Error('Request timed out. Check your connection.');
      throw err;
    } finally {
      clearTimeout(timer);
    }
  },
  post: (path, body) => api.request('POST', path, body),
};

// --- DiagnosisScreen ---
function DiagnosisScreen({ navigate }) {
  const [messages, setMessages] = useState([{ role: 'assistant', content: "Hi! Describe your car problem and I'll help diagnose it. 🔧" }]);
  const [input,    setInput]    = useState('');
  const [loading,  setLoading]  = useState(false);
  const scrollRef = useRef();
  const send = async (override) => {
    const text = (override || input).trim();
    if (!text || loading) return;
    setInput('');
    const msgs = [...messages, { role: 'user', content: text }];
    setMessages(msgs);
    setLoading(true);
    try {
      const { reply } = await api.post('/api/ai/diagnose', { messages: msgs.map(m => ({ role: m.role, content: m.content })) });
      setMessages([...msgs, { role: 'assistant', content: reply }]);
    } catch {
      setMessages([...msgs, { role: 'assistant', content: 'Unable to connect. Please call support: 0800 123 456' }]);
    } finally { setLoading(false); }
  };
  const quickPrompts = ["Won't start - clicking noise", "Steam from bonnet", "Flat tyre, no spare", "Stalled on highway"];
  return (
    <SafeAreaView style={[s.screen, { flex: 1 }]}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={() => navigate('home')}><Text style={[s.body, { color: C.muted }]}>Back</Text></TouchableOpacity>
        <Text style={s.navTitle}>AI Diagnosis</Text>
        <View style={{ width: 50 }} />
      </View>
      <FlatList ref={scrollRef} data={messages} keyExtractor={(_, i) => String(i)} style={{ flex: 1, padding: 14 }} onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}
        renderItem={({ item }) => (
          <View style={{ flexDirection: item.role === 'user' ? 'row-reverse' : 'row', marginBottom: 10, alignItems: 'flex-end' }}>
            <View style={{ maxWidth: '80%', padding: 10, borderRadius: 12, backgroundColor: item.role === 'user' ? C.orange : 'rgba(255,255,255,.08)', borderWidth: item.role !== 'user' ? 1 : 0, borderColor: C.border }}>
              <Text style={[s.small, { color: 'white', lineHeight: 20 }]}>{item.content}</Text>
            </View>
          </View>
        )}
        ListFooterComponent={loading ? <Text style={[s.small, { color: C.muted, padding: 8 }]}>Thinking...</Text> : null}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 8 }}>
        {quickPrompts.map(q => <TouchableOpacity key={q} onPress={() => send(q)} style={s.qp}><Text style={s.tiny}>{q}</Text></TouchableOpacity>)}
      </View>
      <View style={{ flexDirection: 'row', gap: 7, padding: 10, borderTopWidth: 1, borderColor: C.border }}>
        <TextInput value={input} onChangeText={setInput} placeholder="Describe your car problem..." placeholderTextColor={C.muted} style={[s.input, { flex: 1 }]} onSubmitEditing={() => send()} returnKeyType="send" />
        <TouchableOpacity style={{ backgroundColor: C.orange, borderRadius: 7, padding: 10, justifyContent: 'center' }} onPress={() => send()}>
          <Text style={{ color: 'white', fontSize: 16 }}>{'➤'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: C.dark },
  navBar:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  navTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  input:    { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 9, padding: 12, color: C.text, fontSize: 14 },
  qp:       { backgroundColor: 'rgba(255,255,255,.05)', borderWidth: 1, borderColor: C.border, borderRadius: 14, paddingVertical: 4, paddingHorizontal: 10 },
  body:     { fontSize: 14, color: C.muted },
  small:    { fontSize: 12, color: C.muted },
  tiny:     { fontSize: 11, color: C.muted },
});

export default DiagnosisScreen;
