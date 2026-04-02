import React from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, ScrollView,
  Switch, ActivityIndicator, SafeAreaView,
} from 'react-native';

const C = {
  orange: '#E8631A', blue: '#1A7AE8', green: '#00A870', yellow: '#D49A0A',
  dark: '#060F1C', card: '#0C1828', border: '#152030', text: '#ECF0F7', muted: '#7A8AA0',
};

// ─── DashboardScreen ──────────────────────────────────────────────────────────
function DashboardScreen({ navigate, isOnline, onToggle, onSimulate, dashData }) {
  const { todayEarnings, todayJobs, totalJobs, rating, recentJobs, loading, refresh } = dashData;

  const emojiFor = (serviceId) => ({
    jumpstart: '🔋', tyre: '🛞', fuel: '⛽', towing: '🚛', lockout: '🔑',
  }[serviceId] || '🔧');

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: C.dark }}>
      <ScrollView>
        <View style={s.hdr}>
          <View>
            <Text style={s.sub}>Provider App</Text>
            <Text style={s.logo}>Road<Text style={{ color: C.green }}>Ready</Text></Text>
          </View>
          <TouchableOpacity onPress={refresh} style={{ padding: 6 }}>
            <Text style={{ color: C.muted, fontSize: 13 }}>↻</Text>
          </TouchableOpacity>
        </View>

        <View style={s.statusRow}>
          <View>
            <Text style={[s.body, { color: isOnline ? C.green : C.muted, fontWeight: '600' }]}>{isOnline ? '● Online' : '○ Offline'}</Text>
            <Text style={s.tiny}>{isOnline ? 'Accepting jobs' : 'Tap to go online'}</Text>
          </View>
          <Switch value={isOnline} onValueChange={onToggle} trackColor={{ false: C.border, true: C.green }} thumbColor="white" />
        </View>

        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 32 }}>
            <ActivityIndicator color={C.orange} />
            <Text style={[s.tiny, { marginTop: 8 }]}>Loading your stats...</Text>
          </View>
        ) : (
          <>
            <View style={s.grid}>
              {[
                [`KES ${Number(todayEarnings).toLocaleString()}`, "Today's earnings", C.green],
                [String(todayJobs),                               'Jobs today',       C.blue  ],
                [`⭐ ${rating}`,                                   'Your rating',      C.yellow],
                [String(totalJobs),                               'Total jobs',       C.orange],
              ].map(([v, l, c]) => (
                <View key={l} style={s.statCard}>
                  <Text style={[s.body, { fontWeight: '700', color: c }]}>{v}</Text>
                  <Text style={s.tiny}>{l}</Text>
                </View>
              ))}
            </View>

            <Text style={s.secTitle}>Recent Jobs</Text>
            {recentJobs.length === 0 ? (
              <View style={{ alignItems: 'center', paddingVertical: 24, paddingHorizontal: 16 }}>
                <Text style={{ fontSize: 28, marginBottom: 8 }}>🔧</Text>
                <Text style={[s.small, { color: C.muted, textAlign: 'center' }]}>No jobs yet — go online to start accepting</Text>
              </View>
            ) : recentJobs.map(job => (
              <View key={job.id} style={s.jobRow}>
                <Text style={{ fontSize: 22 }}>{job.serviceEmoji || emojiFor(job.serviceId)}</Text>
                <View style={{ flex: 1, marginLeft: 9 }}>
                  <Text style={[s.small, { fontWeight: '600', color: C.text }]}>
                    {job.serviceName || job.serviceId}
                  </Text>
                  <Text style={s.tiny} numberOfLines={1}>
                    {job.address ? job.address.split(',')[0] : ''} · {(job.status || '').replace('_', ' ')}
                  </Text>
                </View>
                {job.status === 'completed' && (
                  <Text style={[s.body, { color: C.green, fontWeight: '600' }]}>
                    +{Number(job.providerEarning || 0).toLocaleString()}
                  </Text>
                )}
              </View>
            ))}
          </>
        )}

        <TouchableOpacity style={s.simBtn} onPress={onSimulate}>
          <Text style={{ fontSize: 16 }}>🎯</Text>
          <View style={{ flex: 1, marginLeft: 9 }}>
            <Text style={[s.small, { color: C.orange, fontWeight: '600' }]}>Simulate job alert</Text>
            <Text style={s.tiny}>Opens job alert with navigation</Text>
          </View>
          <Text style={{ color: C.orange }}>›</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  hdr:       { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, paddingBottom: 10 },
  logo:      { fontSize: 17, fontWeight: '600', color: '#ECF0F7' },
  sub:       { fontSize: 11, color: '#7A8AA0' },
  statusRow: { backgroundColor: '#0C1828', borderWidth: 1, borderColor: '#152030', borderRadius: 11, padding: 12, marginHorizontal: 16, marginBottom: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  grid:      { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 16, gap: 7, marginBottom: 14 },
  statCard:  { width: '47%', backgroundColor: '#0C1828', borderWidth: 1, borderColor: '#152030', borderRadius: 11, padding: 11 },
  secTitle:  { fontSize: 13, fontWeight: '600', color: '#ECF0F7', marginHorizontal: 16, marginBottom: 9 },
  jobRow:    { backgroundColor: '#0C1828', borderWidth: 1, borderColor: '#152030', borderRadius: 10, padding: 10, marginHorizontal: 16, marginBottom: 6, flexDirection: 'row', alignItems: 'center' },
  simBtn:    { backgroundColor: 'rgba(232,99,26,.08)', borderWidth: 1, borderColor: 'rgba(232,99,26,.2)', borderRadius: 9, padding: 12, flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginTop: 6, marginBottom: 24 },
  body:      { fontSize: 14, color: '#7A8AA0' },
  small:     { fontSize: 12, color: '#7A8AA0' },
  tiny:      { fontSize: 11, color: '#7A8AA0' },
});

export default DashboardScreen;
