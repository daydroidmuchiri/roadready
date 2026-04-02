import { useState, useEffect } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

// --- API client with 15s timeout (minimal subset needed by this hook) ---
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
  get: (path) => api.request('GET', path),
};

// --- Services from API with local cache ---
function useServices() {
  const [services, setServices] = useState([]);
  const [loading,  setLoading]  = useState(true);
  useEffect(() => {
    AsyncStorage.getItem('rr_services_cache').then(c => { if (c) setServices(JSON.parse(c)); }).catch(() => {});
    api.get('/api/services')
      .then(data => { if (Array.isArray(data)) { setServices(data); AsyncStorage.setItem('rr_services_cache', JSON.stringify(data)).catch(() => {}); } })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);
  return { services, loading };
}

export default useServices;
