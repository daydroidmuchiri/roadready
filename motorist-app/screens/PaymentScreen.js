import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';
const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// --- API client (subset needed by PaymentScreen) ---
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

// --- PaymentScreen ---
function PaymentScreen({ navigate, params, user }) {
  const [phone,           setPhone]           = useState((user?.phone || '').replace(/^254/, '0'));
  const [paid,            setPaid]            = useState(false);
  const [loading,         setLoading]         = useState(false);
  const [error,           setError]           = useState('');
  const [selectedRating,  setSelectedRating]  = useState(0);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const socketRef = useRef(null);
  const jobId  = params?.jobId;
  const price  = params?.service?.price;

  useEffect(() => {
    if (!jobId) { Alert.alert('Error', 'No active job found.'); navigate('home'); return; }
    let socket;
    AsyncStorage.getItem('rr_token').then(token => {
      if (!token) return;
      socket = io(API, { auth: { token } });
      socketRef.current = socket;
      socket.on('payment_confirmed', ({ jobId: cid }) => {
        if (cid === jobId) { setLoading(false); setPaid(true); AsyncStorage.removeItem('rr_active_job_id').catch(() => {}); }
      });
      socket.on('payment_failed', () => { setLoading(false); setError('Payment was not completed. Please try again.'); });
    });
    return () => socket?.disconnect();
  }, [jobId]);

  const handlePay = async () => {
    const clean = phone.replace(/\s/g, '');
    if (!/^(07|01|\+2547|\+2541)\d{8}$/.test(clean)) { setError('Please enter a valid M-Pesa number'); return; }
    setLoading(true); setError('');
    try { await api.post('/api/payments/mpesa', { jobId, phone: clean }); }
    catch (err) { setLoading(false); setError(err.message || 'Could not connect to M-Pesa.'); }
  };

  const submitRating = async (stars) => {
    setSelectedRating(stars);
    if (!ratingSubmitted && jobId) { setRatingSubmitted(true); api.post('/api/jobs/' + jobId + '/rating', { rating: stars }).catch(() => {}); }
  };

  const ratingText = ['', "We'll look into this", 'Could be better', 'Good', 'Great!', 'Excellent!'];

  if (paid) return (
    <SafeAreaView style={s.screen}>
      <View style={s.centre}>
        <View style={{ width: 70, height: 70, borderRadius: 35, backgroundColor: C.green + '20', borderWidth: 2, borderColor: C.green, alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Text style={{ fontSize: 30 }}>✓</Text>
        </View>
        <Text style={[s.title, { color: C.green, marginBottom: 6 }]}>Payment Complete!</Text>
        <Text style={[s.small, { marginBottom: 6 }]}>How was your experience?</Text>
        <Text style={[s.tiny, { color: C.muted, marginBottom: 16 }]}>Your rating helps other drivers find great providers</Text>
        <View style={{ flexDirection: 'row', gap: 8, marginBottom: 22 }}>
          {[1,2,3,4,5].map(star => (
            <TouchableOpacity key={star} onPress={() => submitRating(star)}>
              <Text style={{ fontSize: 36, opacity: star <= selectedRating ? 1 : 0.3 }}>{'⭐'}</Text>
            </TouchableOpacity>
          ))}
        </View>
        {selectedRating > 0 && <Text style={[s.tiny, { color: C.green, marginBottom: 16 }]}>{ratingText[selectedRating]}</Text>}
        <TouchableOpacity style={s.btn} onPress={() => navigate('home')}>
          <Text style={s.btnTxt}>{selectedRating > 0 ? 'Done' : 'Skip & Done'}</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={s.screen}>
      <View style={s.navBar}>
        <TouchableOpacity onPress={() => navigate('tracking', params)}><Text style={[s.body, { color: C.muted }]}>Back</Text></TouchableOpacity>
        <Text style={s.navTitle}>Payment</Text>
        <View style={{ width: 50 }} />
      </View>
      <ScrollView style={{ padding: 16 }}>
        <View style={[s.card, { alignItems: 'center', marginBottom: 16 }]}>
          <Text style={[s.title, { fontSize: 36 }]}>KES {price ? Number(price).toLocaleString() : '...'}</Text>
          <Text style={[s.tiny, { color: C.green, marginTop: 3 }]}>{'✓'} Locked price · {params?.service?.name || ''}</Text>
        </View>
        <TextInput value={phone} onChangeText={t => { setPhone(t); setError(''); }} placeholder="M-Pesa number (07XX XXX XXX)" placeholderTextColor={C.muted} style={[s.input, { marginBottom: error ? 4 : 10 }]} keyboardType="phone-pad" maxLength={13} />
        {error ? <Text style={{ color: '#E03A3A', fontSize: 12, marginBottom: 10 }}>{error}</Text> : null}
        {loading ? (
          <View style={{ backgroundColor: C.card, borderRadius: 11, padding: 16, alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
            <ActivityIndicator color={C.green} />
            <Text style={[s.small, { marginTop: 10 }]}>Check your phone for the M-Pesa prompt</Text>
            <Text style={[s.tiny, { marginTop: 4 }]}>This may take up to 30 seconds</Text>
          </View>
        ) : (
          <TouchableOpacity style={[s.btn, { backgroundColor: '#009954' }]} onPress={handlePay}>
            <Text style={s.btnTxt}>Pay via M-Pesa</Text>
          </TouchableOpacity>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  screen:   { flex: 1, backgroundColor: C.dark },
  navBar:   { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  navTitle: { fontSize: 15, fontWeight: '600', color: C.text },
  centre:   { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  card:     { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 13, padding: 14 },
  input:    { backgroundColor: C.card, borderWidth: 1, borderColor: C.border, borderRadius: 9, padding: 12, color: C.text, fontSize: 14 },
  btn:      { backgroundColor: C.orange, borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt:   { color: 'white', fontSize: 15, fontWeight: '600' },
  title:    { fontSize: 17, fontWeight: '600', color: C.text },
  body:     { fontSize: 14, color: C.muted },
  small:    { fontSize: 12, color: C.muted },
  tiny:     { fontSize: 11, color: C.muted },
});

export default PaymentScreen;
