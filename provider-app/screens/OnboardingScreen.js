import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, ScrollView,
  ActivityIndicator, SafeAreaView,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { usePhotoUpload } from '../../shared/usePhotoUpload';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// ─── OnboardingScreen ────────────────────────────────────────────────────────
function OnboardingScreen({ navigate }) {
  const { upload, capture, uploading, progress, error, setError } = usePhotoUpload();
  const [profile, setProfile] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [success, setSuccess] = React.useState('');

  React.useEffect(() => {
    AsyncStorage.getItem('rr_token').then(token => {
      fetch(`${API}/api/providers/me`, { headers: { Authorization: `Bearer ${token}` } })
        .then(r => r.json())
        .then(data => { setProfile(data.profile || {}); setLoading(false); })
        .catch(() => setLoading(false));
    });
  }, []);

  const handleUpload = async (uploadType, useCamera = false) => {
    setSuccess(''); setError('');
    const result = useCamera
      ? await capture(uploadType)
      : await upload(uploadType);
    if (result?.url) {
      setSuccess(uploadType === 'id_doc' ? 'ID photo uploaded ✓' : 'Equipment photo uploaded ✓');
      setProfile(prev => ({
        ...prev,
        idDocUrl:        uploadType === 'id_doc'    ? result.url : prev?.idDocUrl,
        equipmentDocUrl: uploadType === 'equipment' ? result.url : prev?.equipmentDocUrl,
      }));
    }
  };

  const steps = [
    { n: 'Phone Verified',    s: 'Completed via OTP',        done: true,                   key: 'phone'     },
    { n: 'ID Verification',   s: profile?.idDocUrl ? 'Uploaded ✓' : 'Upload your national ID', done: !!profile?.idDocUrl, curr: !profile?.idDocUrl, key: 'id_doc' },
    { n: 'Equipment Check',   s: profile?.equipmentDocUrl ? 'Uploaded ✓' : 'Upload photo of your tools', done: !!profile?.equipmentDocUrl, curr: !!profile?.idDocUrl && !profile?.equipmentDocUrl, key: 'equipment' },
    { n: 'Background Check',  s: profile?.backgroundCheck ? 'Cleared ✓' : 'Pending review (1–2 days)', done: !!profile?.backgroundCheck, key: null },
    { n: 'Training',          s: profile?.trainingDone   ? 'Completed ✓' : '3-hour online course',    done: !!profile?.trainingDone,    key: null },
    { n: 'Go Live!',          s: profile?.onboardStatus === 'approved' ? "You're live!" : 'Complete steps above', done: profile?.onboardStatus === 'approved', key: null },
  ];

  const completed = steps.filter(s => s.done).length;
  const pct = Math.round((completed / steps.length) * 100);

  if (loading) return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#060F1C', alignItems:'center', justifyContent:'center' }}>
      <ActivityIndicator color="#E8631A" />
    </SafeAreaView>
  );

  return (
    <SafeAreaView style={{ flex:1, backgroundColor:'#060F1C' }}>
      <View style={{ flexDirection:'row', justifyContent:'space-between', alignItems:'center', padding:16, paddingBottom:10 }}>
        <Text style={{ fontSize:15, fontWeight:'600', color:'#ECF0F7' }}>Provider Onboarding</Text>
        <Text style={{ fontSize:12, color:'#E8631A' }}>{pct}% complete</Text>
      </View>
      <ScrollView style={{ padding:16 }}>
        {/* Progress bar */}
        <View style={{ height:4, backgroundColor:'#0C1828', borderRadius:2, marginBottom:16 }}>
          <View style={{ height:4, backgroundColor:'#E8631A', borderRadius:2, width: pct+'%' }} />
        </View>

        {error  ? <View style={{ backgroundColor:'rgba(224,58,58,.1)', borderWidth:1, borderColor:'rgba(224,58,58,.3)', borderRadius:9, padding:10, marginBottom:10 }}><Text style={{ color:'#E03A3A', fontSize:12 }}>{error}</Text></View>  : null}
        {success? <View style={{ backgroundColor:'rgba(0,168,112,.1)', borderWidth:1, borderColor:'rgba(0,168,112,.3)', borderRadius:9, padding:10, marginBottom:10 }}><Text style={{ color:'#00A870', fontSize:12 }}>{success}</Text></View> : null}

        {uploading && (
          <View style={{ backgroundColor:'#0C1828', borderWidth:1, borderColor:'#152030', borderRadius:9, padding:10, marginBottom:10, flexDirection:'row', alignItems:'center', gap:10 }}>
            <ActivityIndicator color="#E8631A" size="small" />
            <Text style={{ color:'#E8631A', fontSize:12 }}>Uploading... {progress}%</Text>
          </View>
        )}

        {steps.map((step, i) => (
          <View key={i} style={{
            flexDirection:'row', alignItems:'center', padding:12,
            borderWidth:1,
            borderColor: step.curr ? 'rgba(232,99,26,.35)' : step.done ? 'rgba(0,168,112,.25)' : '#152030',
            borderRadius:10, marginBottom:8,
            backgroundColor: step.curr ? 'rgba(232,99,26,.07)' : step.done ? 'rgba(0,168,112,.05)' : '#0C1828',
          }}>
            <View style={{
              width:24, height:24, borderRadius:12, marginRight:10,
              alignItems:'center', justifyContent:'center',
              backgroundColor: step.done ? 'rgba(0,168,112,.2)' : step.curr ? 'rgba(232,99,26,.2)' : '#152030',
            }}>
              <Text style={{ fontSize:10, color: step.done ? '#00A870' : step.curr ? '#E8631A' : '#7A8AA0' }}>
                {step.done ? '✓' : i+1}
              </Text>
            </View>
            <View style={{ flex:1 }}>
              <Text style={{ fontSize:12, fontWeight:'600', color:'#ECF0F7' }}>{step.n}</Text>
              <Text style={{ fontSize:10, marginTop:2, color: step.done ? '#00A870' : '#7A8AA0' }}>{step.s}</Text>
            </View>
            {/* Upload buttons for ID and equipment steps */}
            {step.key && !step.done && (
              <View style={{ flexDirection:'row', gap:6 }}>
                <TouchableOpacity
                  onPress={() => handleUpload(step.key, false)}
                  disabled={uploading}
                  style={{ backgroundColor:'rgba(232,99,26,.15)', borderWidth:1, borderColor:'rgba(232,99,26,.3)', borderRadius:7, paddingHorizontal:8, paddingVertical:5 }}>
                  <Text style={{ color:'#E8631A', fontSize:10 }}>📁 Gallery</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => handleUpload(step.key, true)}
                  disabled={uploading}
                  style={{ backgroundColor:'rgba(232,99,26,.15)', borderWidth:1, borderColor:'rgba(232,99,26,.3)', borderRadius:7, paddingHorizontal:8, paddingVertical:5 }}>
                  <Text style={{ color:'#E8631A', fontSize:10 }}>📷 Camera</Text>
                </TouchableOpacity>
              </View>
            )}
            {step.key && step.done && (
              <TouchableOpacity
                onPress={() => handleUpload(step.key, false)}
                disabled={uploading}
                style={{ backgroundColor:'rgba(0,168,112,.1)', borderRadius:7, paddingHorizontal:8, paddingVertical:5 }}>
                <Text style={{ color:'#00A870', fontSize:10 }}>Re-upload</Text>
              </TouchableOpacity>
            )}
          </View>
        ))}

        {profile?.onboardStatus !== 'approved' && (
          <View style={{ backgroundColor:'rgba(26,122,232,.08)', borderWidth:1, borderColor:'rgba(26,122,232,.2)', borderRadius:10, padding:12, marginTop:4 }}>
            <Text style={{ color:'#1A7AE8', fontSize:12, fontWeight:'600', marginBottom:4 }}>What happens after upload?</Text>
            <Text style={{ color:'#7A8AA0', fontSize:11, lineHeight:17 }}>
              Our team reviews your documents within 24–48 hours. You'll receive a push notification when your account is approved and you can start accepting jobs.
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

export default OnboardingScreen;
