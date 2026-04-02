import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, SafeAreaView,
} from 'react-native';

const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// ─── DoneScreen ───────────────────────────────────────────────────────────────
function DoneScreen({ navigate, params }) {
  const earning = params?.job?.providerEarning;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.dark, padding: 16 }}>
      <View style={{ backgroundColor: 'rgba(0,168,112,.08)', borderWidth: 1, borderColor: 'rgba(0,168,112,.2)', borderRadius: 13, padding: 18, alignItems: 'center', marginBottom: 14 }}>
        <Text style={{ fontSize: 36, marginBottom: 9 }}>✅</Text>
        <Text style={[s.title, { color: C.green }]}>
          {earning ? `KES ${Number(earning).toLocaleString()} earned` : 'Job Complete!'}
        </Text>
        <Text style={s.tiny}>Payout in 48 hours via M-Pesa</Text>
      </View>
      <TouchableOpacity style={[s.btn, { backgroundColor: C.green }]} onPress={() => navigate('dashboard')}>
        <Text style={s.btnTxt}>Back to Dashboard</Text>
      </TouchableOpacity>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  btn:    { backgroundColor: '#E8631A', borderRadius: 11, padding: 14, alignItems: 'center' },
  btnTxt: { color: 'white', fontSize: 15, fontWeight: '600' },
  title:  { fontSize: 17, fontWeight: '600', color: '#ECF0F7' },
  tiny:   { fontSize: 11, color: '#7A8AA0' },
});

export default DoneScreen;
