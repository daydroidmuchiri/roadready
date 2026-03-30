/**
 * RoadReady — OTP Authentication Screens
 *
 * Three screens that handle the full auth flow:
 *
 *   <PhoneScreen />   — enter phone number, request OTP
 *   <OTPScreen />     — enter 6-digit code, auto-submit on last digit
 *   <NameScreen />    — collect name for new users only (shown once)
 *
 * Usage in your root App.js:
 *
 *   import { AuthFlow } from '../shared/AuthScreens';
 *
 *   export default function App() {
 *     const [authed, setAuthed] = useState(false);
 *     if (!authed) return <AuthFlow onAuthenticated={() => setAuthed(true)} role="motorist" />;
 *     return <MainApp />;
 *   }
 *
 * Install: nothing extra needed beyond what's already in the project.
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, TextInput,
  KeyboardAvoidingView, Platform, ActivityIndicator,
  Keyboard, Animated, SafeAreaView, Alert,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { registerTokenAfterLogin } from './useNotifications';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

const C = {
  orange: '#E8631A', green: '#00A870', blue: '#1A7AE8',
  dark: '#060F1C', card: '#0C1828', border: '#152030',
  text: '#ECF0F7', muted: '#7A8AA0', error: '#E03A3A',
};

const PHONE_PATTERN = /^(07|01|\+2547|\+2541)\d{8}$/;

// ─── AuthFlow ─────────────────────────────────────────────────────────────────
// Root component — manages which auth screen is active

export function AuthFlow({ onAuthenticated, role = 'motorist' }) {
  const [step,  setStep]  = useState('phone');   // 'phone' | 'otp' | 'name'
  const [phone, setPhone] = useState('');
  const [isNew, setIsNew] = useState(false);

  const handlePhoneDone = ({ phone: p, isNewUser }) => {
    setPhone(p);
    setIsNew(isNewUser);
    setStep('otp');
  };

  const handleOTPDone = ({ isNewUser, token, user }) => {
    if (isNewUser && (!user.name || user.name === 'New User')) {
      setStep('name');
    } else {
      finishAuth(token, user);
    }
  };

  const handleNameDone = ({ token, user }) => {
    finishAuth(token, user);
  };

  const finishAuth = async (token, user) => {
    await AsyncStorage.setItem('rr_token', token);
    await AsyncStorage.setItem('rr_user', JSON.stringify(user));
    await registerTokenAfterLogin();
    onAuthenticated(user);
  };

  if (step === 'phone') return <PhoneScreen role={role} onDone={handlePhoneDone} />;
  if (step === 'otp')   return <OTPScreen phone={phone} role={role} onDone={handleOTPDone} onBack={() => setStep('phone')} />;
  if (step === 'name')  return <NameScreen phone={phone} role={role} onDone={handleNameDone} />;
  return null;
}

// ─── PhoneScreen ──────────────────────────────────────────────────────────────

export function PhoneScreen({ role, onDone }) {
  const [phone,   setPhone]   = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const inputRef = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 300); }, []);

  // Format as user types: 0712 345 678
  const handleChange = (text) => {
    const digits = text.replace(/\D/g, '').slice(0, 10);
    let formatted = digits;
    if (digits.length > 4) formatted = digits.slice(0,4) + ' ' + digits.slice(4);
    if (digits.length > 7) formatted = digits.slice(0,4) + ' ' + digits.slice(4,7) + ' ' + digits.slice(7);
    setPhone(formatted);
    setError('');
  };

  const cleanPhone = phone.replace(/\s/g, '');
  const isValid    = PHONE_PATTERN.test(cleanPhone);

  const handleSend = async () => {
    if (!isValid) {
      setError('Please enter a valid Kenyan phone number');
      return;
    }
    Keyboard.dismiss();
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`${API}/api/auth/otp/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone: cleanPhone, role }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error?.message || 'Failed to send code');

      // Dev mode: show the code so you can test without real SMS
      if (data.devCode) {
        Alert.alert('Dev Mode', `OTP code: ${data.devCode}`, [{ text: 'OK' }]);
      }

      onDone({ phone: cleanPhone, isNewUser: data.isNewUser });
    } catch (err) {
      setError(err.message || 'Could not send code. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={a.screen}>
      <KeyboardAvoidingView style={a.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={a.top}>
          <Text style={a.logo}>Road<Text style={{ color: C.orange }}>Ready</Text></Text>
          <Text style={a.headline}>Enter your phone number</Text>
          <Text style={a.sub}>We'll send you a verification code via SMS</Text>
        </View>

        <View style={a.form}>
          <View style={[a.inputWrap, error ? a.inputError : isValid ? a.inputValid : null]}>
            <Text style={a.prefix}>🇰🇪 +254</Text>
            <TextInput
              ref={inputRef}
              style={a.input}
              value={phone}
              onChangeText={handleChange}
              placeholder="0712 345 678"
              placeholderTextColor={C.muted}
              keyboardType="phone-pad"
              returnKeyType="done"
              onSubmitEditing={handleSend}
              maxLength={13}
            />
            {isValid && <Text style={a.tick}>✓</Text>}
          </View>

          {error ? <Text style={a.errorTxt}>{error}</Text> : null}

          <TouchableOpacity
            style={[a.btn, (!isValid || loading) && a.btnDisabled]}
            onPress={handleSend}
            disabled={!isValid || loading}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text style={a.btnTxt}>Send Code →</Text>
            }
          </TouchableOpacity>

          <Text style={a.disclaimer}>
            By continuing you agree to receive an SMS. Standard rates may apply.
          </Text>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── OTPScreen ────────────────────────────────────────────────────────────────

export function OTPScreen({ phone, role, onDone, onBack }) {
  const [code,     setCode]     = useState(['', '', '', '', '', '']);
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState('');
  const [resendIn, setResendIn] = useState(30);   // seconds until can resend
  const [resending,setResending]= useState(false);
  const inputRefs = useRef([]);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => { setTimeout(() => inputRefs.current[0]?.focus(), 300); }, []);

  // Countdown for resend button
  useEffect(() => {
    if (resendIn <= 0) return;
    const timer = setTimeout(() => setResendIn(t => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendIn]);

  const shake = () => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 10,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -10, duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 10,  duration: 50, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,   duration: 50, useNativeDriver: true }),
    ]).start();
  };

  const handleDigit = (index, digit) => {
    // Handle paste: if user pastes 6 digits into first box
    if (digit.length > 1) {
      const digits = digit.replace(/\D/g, '').slice(0, 6).split('');
      const newCode = [...code];
      digits.forEach((d, i) => { if (i < 6) newCode[i] = d; });
      setCode(newCode);
      setError('');
      if (digits.length === 6) {
        inputRefs.current[5]?.focus();
        submitCode(newCode.join(''));
      } else {
        inputRefs.current[digits.length]?.focus();
      }
      return;
    }

    const newCode = [...code];
    newCode[index] = digit.replace(/\D/g, '').slice(-1);
    setCode(newCode);
    setError('');

    if (digit && index < 5) {
      inputRefs.current[index + 1]?.focus();
    }

    // Auto-submit when all 6 digits filled
    if (newCode.every(d => d !== '') && digit) {
      Keyboard.dismiss();
      submitCode(newCode.join(''));
    }
  };

  const handleBackspace = (index, value) => {
    if (!value && index > 0) {
      const newCode = [...code];
      newCode[index - 1] = '';
      setCode(newCode);
      inputRefs.current[index - 1]?.focus();
    }
  };

  const submitCode = useCallback(async (codeStr) => {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      const res  = await fetch(`${API}/api/auth/otp/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, code: codeStr, role, name: 'New User' }),
      });
      const data = await res.json();

      if (!res.ok) {
        if (data.error?.fields) {
          Alert.alert('Validation Error Details', JSON.stringify(data.error.fields), [{ text: 'OK' }]);
        }
        const msg = data.error?.message || 'Incorrect code. Please try again.';
        setError(msg);
        setCode(['', '', '', '', '', '']);
        shake();
        inputRefs.current[0]?.focus();
        return;
      }

      onDone({ token: data.token, user: data.user, isNewUser: data.isNewUser });
    } catch (err) {
      setError('Network error. Please try again.');
      shake();
    } finally {
      setLoading(false);
    }
  }, [phone, role, loading]);

  const handleResend = async () => {
    if (resendIn > 0 || resending) return;
    setResending(true);
    setCode(['', '', '', '', '', '']);
    setError('');
    try {
      const res  = await fetch(`${API}/api/auth/otp/send`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ phone, role }),
      });
      const data = await res.json();
      if (data.devCode) Alert.alert('Dev Mode', `New OTP: ${data.devCode}`);
      setResendIn(30);
      inputRefs.current[0]?.focus();
    } catch {
      setError('Could not resend. Please try again.');
    } finally {
      setResending(false);
    }
  };

  const maskedPhone = phone.replace(/(\d{3})\d{4}(\d{3})/, '$1****$2');

  return (
    <SafeAreaView style={a.screen}>
      <KeyboardAvoidingView style={a.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <TouchableOpacity style={a.backBtn} onPress={onBack}>
          <Text style={a.backTxt}>‹ Back</Text>
        </TouchableOpacity>

        <View style={a.top}>
          <Text style={a.headline}>Enter the code</Text>
          <Text style={a.sub}>Sent to {maskedPhone}</Text>
        </View>

        <Animated.View style={[a.otpRow, { transform: [{ translateX: shakeAnim }] }]}>
          {code.map((digit, i) => (
            <TextInput
              key={i}
              ref={el => { inputRefs.current[i] = el; }}
              style={[a.otpBox, digit && a.otpFilled, error && a.otpError]}
              value={digit}
              onChangeText={d => handleDigit(i, d)}
              onKeyPress={({ nativeEvent }) => {
                if (nativeEvent.key === 'Backspace') handleBackspace(i, digit);
              }}
              keyboardType="number-pad"
              maxLength={6}          // allow paste of full code into first box
              textAlign="center"
              selectTextOnFocus
              editable={!loading}
            />
          ))}
        </Animated.View>

        {error ? <Text style={a.errorTxt}>{error}</Text> : null}

        {loading && (
          <View style={a.verifying}>
            <ActivityIndicator color={C.orange} size="small" />
            <Text style={a.verifyingTxt}>Verifying...</Text>
          </View>
        )}

        <TouchableOpacity
          style={[a.resendBtn, (resendIn > 0 || resending) && a.resendDisabled]}
          onPress={handleResend}
          disabled={resendIn > 0 || resending}
        >
          <Text style={[a.resendTxt, resendIn > 0 && { color: C.muted }]}>
            {resendIn > 0
              ? `Resend code in ${resendIn}s`
              : resending ? 'Sending...' : 'Resend code'}
          </Text>
        </TouchableOpacity>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── NameScreen ───────────────────────────────────────────────────────────────
// Shown only for brand-new users — collect their name to complete registration

export function NameScreen({ phone, role, onDone }) {
  const [name,    setName]    = useState('');
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');
  const inputRef  = useRef(null);

  useEffect(() => { setTimeout(() => inputRef.current?.focus(), 300); }, []);

  const isValid = name.trim().length >= 2;

  const handleSubmit = async () => {
    if (!isValid) { setError('Please enter your full name'); return; }
    Keyboard.dismiss();
    setLoading(true);
    setError('');

    try {
      const token = await AsyncStorage.getItem('rr_token');
      if (!token) { setError('Session expired. Please start again.'); return; }

      const res = await fetch(`${API}/api/auth/me/name`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ name: name.trim() }),
      });
      const data = await res.json();

      if (!res.ok) {
        setError(data.error?.message || 'Could not save your name. Please try again.');
        return;
      }

      // Persist updated user to cache
      await AsyncStorage.setItem('rr_user', JSON.stringify(data.user));
      onDone({ token, user: data.user });
    } catch {
      setError('Network error. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={a.screen}>
      <KeyboardAvoidingView style={a.kav} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <View style={a.top}>
          <Text style={a.logo}>Welcome! 👋</Text>
          <Text style={a.headline}>What's your name?</Text>
          <Text style={a.sub}>This is how you'll appear to providers</Text>
        </View>

        <View style={a.form}>
          <View style={[a.inputWrap, error ? a.inputError : isValid ? a.inputValid : null]}>
            <TextInput
              ref={inputRef}
              style={[a.input, { paddingLeft: 16 }]}
              value={name}
              onChangeText={t => { setName(t); setError(''); }}
              placeholder="Your full name"
              placeholderTextColor={C.muted}
              autoCapitalize="words"
              returnKeyType="done"
              onSubmitEditing={handleSubmit}
              maxLength={100}
            />
          </View>

          {error ? <Text style={a.errorTxt}>{error}</Text> : null}

          <TouchableOpacity
            style={[a.btn, (!isValid || loading) && a.btnDisabled]}
            onPress={handleSubmit}
            disabled={!isValid || loading}
          >
            {loading
              ? <ActivityIndicator color="white" />
              : <Text style={a.btnTxt}>Get Started →</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ─── useAuth hook ─────────────────────────────────────────────────────────────
// Use this in App.js to check if the user is already logged in.

import { useState as useStateHook, useEffect as useEffectHook } from 'react';

export function useAuth() {
  const [user,    setUser]    = useStateHook(null);
  const [loading, setLoading] = useStateHook(true);

  useEffectHook(() => {
    checkAuthState();
  }, []);

  async function checkAuthState() {
    try {
      const token = await AsyncStorage.getItem('rr_token');
      if (!token) { setLoading(false); return; }

      // Validate token with server — also refreshes it if near expiry
      const res = await fetch(`${API}/api/auth/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });

      if (res.ok) {
        const data = await res.json();
        setUser(data.user);

        // Proactively refresh token if it expires within 2 days
        const refreshRes = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (refreshRes.ok) {
          const refreshData = await refreshRes.json();
          await AsyncStorage.setItem('rr_token', refreshData.token);
        }
      } else {
        // Token is invalid or expired — clear it
        await AsyncStorage.removeItem('rr_token');
        await AsyncStorage.removeItem('rr_user');
      }
    } catch {
      // Network error — try using cached user if available
      const cached = await AsyncStorage.getItem('rr_user');
      if (cached) setUser(JSON.parse(cached));
    } finally {
      setLoading(false);
    }
  }

  async function logout() {
    await AsyncStorage.removeItem('rr_token');
    await AsyncStorage.removeItem('rr_user');
    setUser(null);
  }

  // Silent token refresh every 6 hours while app is running
  useEffectHook(() => {
    const REFRESH_INTERVAL = 6 * 60 * 60 * 1000;
    const interval = setInterval(async () => {
      try {
        const token = await AsyncStorage.getItem('rr_token');
        if (!token) return;
        const res = await fetch(`${API}/api/auth/refresh`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          await AsyncStorage.setItem('rr_token', data.token);
          await AsyncStorage.setItem('rr_user', JSON.stringify(data.user));
          setUser(data.user);
        }
      } catch { /* network error — keep using existing token */ }
    }, REFRESH_INTERVAL);
    return () => clearInterval(interval);
  }, []);

  return { user, loading, logout, refetch: checkAuthState };
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const a = StyleSheet.create({
  screen:      { flex: 1, backgroundColor: C.dark },
  kav:         { flex: 1, paddingHorizontal: 24 },
  backBtn:     { marginTop: 16, marginBottom: 8 },
  backTxt:     { color: C.muted, fontSize: 16 },
  top:         { paddingTop: 40, paddingBottom: 32 },
  logo:        { fontSize: 28, fontWeight: '700', color: C.text, marginBottom: 24 },
  headline:    { fontSize: 26, fontWeight: '700', color: C.text, marginBottom: 8, letterSpacing: -0.5 },
  sub:         { fontSize: 15, color: C.muted, lineHeight: 22 },
  form:        { flex: 1 },

  // Phone input
  inputWrap:   { flexDirection: 'row', alignItems: 'center', backgroundColor: C.card, borderWidth: 1.5, borderColor: C.border, borderRadius: 12, paddingHorizontal: 14, height: 56, marginBottom: 12 },
  inputError:  { borderColor: C.error },
  inputValid:  { borderColor: C.green },
  prefix:      { fontSize: 15, color: C.text, marginRight: 8 },
  input:       { flex: 1, fontSize: 18, color: C.text, letterSpacing: 1 },
  tick:        { fontSize: 18, color: C.green, marginLeft: 8 },

  // OTP boxes
  otpRow:      { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 16 },
  otpBox:      { width: 48, height: 60, borderRadius: 12, borderWidth: 1.5, borderColor: C.border, backgroundColor: C.card, fontSize: 24, fontWeight: '700', color: C.text, textAlign: 'center' },
  otpFilled:   { borderColor: C.orange, backgroundColor: 'rgba(232,99,26,.08)' },
  otpError:    { borderColor: C.error },

  // Buttons
  btn:         { backgroundColor: C.orange, borderRadius: 12, height: 54, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  btnDisabled: { opacity: 0.45 },
  btnTxt:      { color: 'white', fontSize: 16, fontWeight: '700' },

  resendBtn:   { alignItems: 'center', paddingVertical: 12 },
  resendDisabled:{ opacity: .5 },
  resendTxt:   { color: C.orange, fontSize: 15, fontWeight: '500' },

  verifying:   { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 16 },
  verifyingTxt:{ color: C.muted, fontSize: 14 },

  errorTxt:    { color: C.error, fontSize: 13, marginBottom: 12, textAlign: 'center' },
  disclaimer:  { color: C.muted, fontSize: 12, textAlign: 'center', lineHeight: 18, marginTop: 4 },
});
