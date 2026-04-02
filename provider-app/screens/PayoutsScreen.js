import React from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  TextInput, ActivityIndicator, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// ─── PayoutsScreen ───────────────────────────────────────────────────────────────
function PayoutsScreen({ navigate }) {
  const [pending,  setPending]  = React.useState(null);
  const [history,  setHistory]  = React.useState([]);
  const [phone,    setPhone]    = React.useState('');
  const [loading,  setLoading]  = React.useState(true);
  const [paying,   setPaying]   = React.useState(false);
  const [error,    setError]    = React.useState('');
  const [success,  setSuccess]  = React.useState('');

  React.useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const token = await AsyncStorage.getItem('rr_token');
      const headers = { Authorization: `Bearer ${token}` };
      const [pendingRes, historyRes] = await Promise.all([
        fetch(`${API}/api/payouts/me/pending`, { headers }).then(r => r.json()),
        fetch(`${API}/api/payouts/me`,         { headers }).then(r => r.json()),
      ]);
      setPending(pendingRes);
      setHistory(Array.isArray(historyRes) ? historyRes : []);
    } catch { setError('Could not load payout data'); }
    finally   { setLoading(false); }
  };

  const requestPayout = async () => {
    if (!phone || !/^(07|01)\d{8}$/.test(phone.replace(/\s/g,''))) {
      setError('Enter a valid M-Pesa number'); return;
    }
    setPaying(true); setError(''); setSuccess('');
    try {
      const token = await AsyncStorage.getItem('rr_token');
      const res   = await fetch(`${API}/api/payouts/request`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ mpesaPhone: phone.replace(/\s/g,'') }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error?.message || 'Payout failed'); return; }
      setSuccess(data.message);
      await loadData();
    } catch { setError('Network error. Try again.'); }
    finally   { setPaying(false); }
  };

  const C2 = { orange: '#E8631A', green: '#00A870', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0' };

  if (loading) return (
    <SafeAreaView style={{ flex:1, backgroundColor: '#060F1C', alignItems:'center', justifyContent:'center' }}>
      <ActivityIndicator color="#E8631A" />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#060F1C' }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, paddingBottom:10 }}>
        <Text style={{ fontSize:15, fontWeight:'600', color:C2.text }}>Earnings &amp; Payouts</Text>
      </View>
      <ScrollView style={{ padding:16 }}>
        {/* Pending earnings */}
        <View style={{ backgroundColor:C2.card, borderWidth:1, borderColor:C2.border, borderRadius:13, padding:16, marginBottom:14 }}>
          <Text style={{ fontSize:12, color:C2.muted, marginBottom:4 }}>Pending earnings</Text>
          <Text style={{ fontSize:32, fontWeight:'700', color:C2.green }}>KES {(pending?.totalPending||0).toLocaleString()}</Text>
          <Text style={{ fontSize:11, color:C2.muted, marginTop:3 }}>{pending?.jobCount||0} completed job{pending?.jobCount!==1?'s':''} not yet paid out</Text>
        </View>

        {/* Request payout */}
        {(pending?.totalPending||0) >= 100 && (
          <View style={{ backgroundColor:C2.card, borderWidth:1, borderColor:C2.border, borderRadius:13, padding:16, marginBottom:14 }}>
            <Text style={{ fontSize:13, fontWeight:'600', color:C2.text, marginBottom:10 }}>Request Payout</Text>
            <TextInput
              value={phone} onChangeText={setPhone}
              placeholder="M-Pesa number (07XX XXX XXX)"
              placeholderTextColor={C2.muted}
              keyboardType="phone-pad"
              style={{ backgroundColor:'#060F1C', borderWidth:1, borderColor:C2.border, borderRadius:9, padding:'11px 13px', color:C2.text, fontSize:14, marginBottom:10 }}
            />
            {error  ? <Text style={{ color:'#E03A3A', fontSize:12, marginBottom:8  }}>{error}</Text>  : null}
            {success? <Text style={{ color:C2.green,  fontSize:12, marginBottom:8  }}>{success}</Text>: null}
            <TouchableOpacity
              style={{ backgroundColor:C2.green, borderRadius:11, padding:13, alignItems:'center', opacity:paying?0.6:1 }}
              onPress={requestPayout} disabled={paying}
            >
              {paying ? <ActivityIndicator color="white" /> : <Text style={{ color:'white', fontSize:14, fontWeight:'600' }}>Request KES {(pending?.totalPending||0).toLocaleString()} via M-Pesa</Text>}
            </TouchableOpacity>
            <Text style={{ fontSize:11, color:C2.muted, textAlign:'center', marginTop:8 }}>Payouts sent within 48 hours</Text>
          </View>
        )}

        {/* Payout history */}
        {history.length > 0 && (
          <>
            <Text style={{ fontSize:13, fontWeight:'600', color:C2.text, marginBottom:9 }}>Payout History</Text>
            {history.map((p, i) => (
              <View key={p.id||i} style={{ backgroundColor:C2.card, borderWidth:1, borderColor:C2.border, borderRadius:10, padding:'10px 13px', marginBottom:7, flexDirection:'row', alignItems:'center' }}>
                <View style={{ flex:1 }}>
                  <Text style={{ fontSize:14, fontWeight:'600', color:C2.green }}>KES {(p.amount||0).toLocaleString()}</Text>
                  <Text style={{ fontSize:11, color:C2.muted, marginTop:2 }}>{p.jobCount} jobs · {new Date(p.initiatedAt).toLocaleDateString()}</Text>
                  {p.mpesaReceipt && <Text style={{ fontSize:10, color:C2.muted }}>Ref: {p.mpesaReceipt}</Text>}
                </View>
                <View style={{ backgroundColor: p.status==='completed'?'rgba(0,168,112,.15)':'rgba(212,154,10,.15)', borderRadius:6, paddingHorizontal:8, paddingVertical:3 }}>
                  <Text style={{ fontSize:10, fontWeight:'600', color: p.status==='completed'?C2.green:'#D49A0A' }}>{(p.status||'').toUpperCase()}</Text>
                </View>
              </View>
            ))}
          </>
        )}

        {history.length === 0 && !pending?.totalPending && (
          <View style={{ alignItems:'center', padding:32 }}>
            <Text style={{ fontSize:32, marginBottom:12 }}>💰</Text>
            <Text style={{ fontSize:15, color:C2.text, marginBottom:6 }}>No payouts yet</Text>
            <Text style={{ fontSize:12, color:C2.muted, textAlign:'center' }}>Complete jobs to start earning. Payouts are processed every 48 hours.</Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default PayoutsScreen;
