import React, { useState, useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Animated, Modal,
} from 'react-native';
import {
  scheduleLocalNotification, cancelLocalNotification,
} from '../../shared/useNotifications';

const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// ─── Job Alert Modal ──────────────────────────────────────────────────────────
function JobAlertModal({ job, onAccept, onDecline }) {
  const [timeLeft, setTimeLeft] = useState(job?.expiresInSeconds || 60);
  const slideAnim  = useRef(new Animated.Value(400)).current;
  const expiryRef  = useRef(null);

  useEffect(() => {
    Animated.spring(slideAnim, { toValue: 0, tension: 100, friction: 8, useNativeDriver: true }).start();
    scheduleLocalNotification('Job alert expiring!', `10 seconds left to accept ${job?.serviceName}`, 50)
      .then(id => { expiryRef.current = id; });

    const timer = setInterval(() => {
      setTimeLeft(t => {
        if (t <= 1) { clearInterval(timer); onDecline(); return 0; }
        return t - 1;
      });
    }, 1000);
    return () => { clearInterval(timer); if (expiryRef.current) cancelLocalNotification(expiryRef.current); };
  }, []);

  if (!job) return null;
  const urgency = timeLeft <= 10 ? '#E03A3A' : timeLeft <= 20 ? C.yellow : C.orange;

  return (
    <Modal transparent animationType="none" statusBarTranslucent>
      <View style={ja.overlay}>
        <Animated.View style={[ja.panel, { transform: [{ translateY: slideAnim }] }]}>
          <View style={ja.hdr}>
            <View style={[ja.dot, { backgroundColor: urgency }]} />
            <Text style={[ja.lbl, { color: urgency }]}>NEW JOB AVAILABLE</Text>
            <View style={[ja.pill, { backgroundColor: urgency + '20', borderColor: urgency + '50' }]}>
              <Text style={[ja.pillTxt, { color: urgency }]}>{timeLeft}s</Text>
            </View>
          </View>
          <View style={ja.box}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={ja.svcName}>{job.serviceEmoji} {job.serviceName}</Text>
                <Text style={ja.addr}>📍 {job.address}</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginTop: 6 }}>
                  <Text style={ja.meta}>{job.distanceKm?.toFixed(1)}km</Text>
                  <Text style={ja.meta}>·</Text>
                  <Text style={ja.meta}>~{Math.round((job.distanceKm / 30) * 60)} min</Text>
                </View>
              </View>
              <View style={{ alignItems: 'flex-end' }}>
                <Text style={ja.earn}>KES {job.providerEarning?.toLocaleString()}</Text>
                <Text style={ja.earnLbl}>you earn</Text>
              </View>
            </View>
          </View>
          <View style={ja.btns}>
            <TouchableOpacity style={ja.btnNo} onPress={onDecline}>
              <Text style={ja.btnNoTxt}>Decline</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[ja.btnYes, { backgroundColor: urgency }]} onPress={onAccept}>
              <Text style={ja.btnYesTxt}>Accept Job ›</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const ja = StyleSheet.create({
  overlay:  { flex: 1, backgroundColor: 'rgba(0,0,0,.88)', justifyContent: 'flex-end' },
  panel:    { backgroundColor: '#0C1826', borderTopLeftRadius: 22, borderTopRightRadius: 22, padding: 20, paddingBottom: 34, borderTopWidth: 1, borderColor: 'rgba(232,99,26,.3)' },
  hdr:      { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dot:      { width: 9, height: 9, borderRadius: 5, marginRight: 7 },
  lbl:      { fontSize: 11, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 1, flex: 1 },
  pill:     { borderWidth: 1, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 3 },
  pillTxt:  { fontSize: 13, fontWeight: '700' },
  box:      { backgroundColor: '#060F1C', borderRadius: 12, padding: 13, marginBottom: 14 },
  svcName:  { fontSize: 15, fontWeight: '600', color: '#ECF0F7', marginBottom: 4 },
  addr:     { fontSize: 11, color: '#7A8AA0', marginBottom: 4 },
  meta:     { fontSize: 11, color: '#7A8AA0' },
  earn:     { fontSize: 20, fontWeight: '700', color: '#E8631A' },
  earnLbl:  { fontSize: 10, color: '#7A8AA0', marginTop: 2 },
  btns:     { flexDirection: 'row', gap: 10 },
  btnNo:    { flex: 1, backgroundColor: '#060F1C', borderWidth: 1, borderColor: '#152030', borderRadius: 10, padding: 14, alignItems: 'center' },
  btnNoTxt: { fontSize: 14, fontWeight: '600', color: '#7A8AA0' },
  btnYes:   { flex: 2, borderRadius: 10, padding: 14, alignItems: 'center' },
  btnYesTxt:{ fontSize: 15, fontWeight: '700', color: 'white' },
});

export default JobAlertModal;
