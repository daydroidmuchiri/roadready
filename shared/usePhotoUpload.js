/**
 * RoadReady — usePhotoUpload hook
 *
 * Handles the two-step Cloudinary upload flow:
 *   1. GET signed params from our backend (/api/uploads/sign)
 *   2. POST image directly to Cloudinary CDN
 *   3. POST confirmation to our backend (/api/uploads/confirm)
 *
 * Usage:
 *   const { upload, uploading, progress, error } = usePhotoUpload();
 *   await upload('id_doc');    // picks photo from camera roll and uploads
 *
 * Install:
 *   npx expo install expo-image-picker expo-file-system
 */

import { useState, useCallback } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem  from 'expo-file-system';
import AsyncStorage     from '@react-native-async-storage/async-storage';

const API = process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3001';

export function usePhotoUpload() {
  const [uploading, setUploading] = useState(false);
  const [progress,  setProgress]  = useState(0);
  const [error,     setError]     = useState('');

  const upload = useCallback(async (uploadType, options = {}) => {
    setError('');
    setProgress(0);

    // ── Step 1: Request permission and pick image ──────────────────────────
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      setError('Photo library permission required. Please allow access in Settings.');
      return null;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing:  options.allowsEditing !== false,
      aspect:         options.aspect || [4, 3],
      quality:        options.quality || 0.8,
      base64:         false,
    });

    if (result.canceled || !result.assets?.[0]) return null;

    const asset = result.assets[0];
    setUploading(true);
    setProgress(10);

    try {
      const token = await AsyncStorage.getItem('rr_token');

      // ── Step 2: Get signed upload params from our backend ────────────────
      const signRes = await fetch(`${API}/api/uploads/sign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ uploadType }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) throw new Error(signData.error?.message || 'Failed to get upload signature');

      setProgress(25);

      // Dev mode — skip real upload
      if (signData.mock) {
        setProgress(100);
        setUploading(false);
        return { url: asset.uri, uploadType, mock: true };
      }

      // ── Step 3: Upload directly to Cloudinary ──────────────────────────
      const uploadUrl = `https://api.cloudinary.com/v1_1/${signData.cloudName}/image/upload`;

      // Build form data
      const formData = new FormData();
      formData.append('file', {
        uri:  asset.uri,
        type: asset.mimeType || 'image/jpeg',
        name: `upload_${Date.now()}.jpg`,
      });
      formData.append('api_key',    signData.apiKey);
      formData.append('timestamp',  String(signData.timestamp));
      formData.append('signature',  signData.signature);
      formData.append('folder',     signData.folder);
      formData.append('public_id',  signData.publicId);
      formData.append('eager',      'q_auto');

      setProgress(40);

      // Use FileSystem.uploadAsync for progress tracking
      const uploadResult = await FileSystem.uploadAsync(uploadUrl, asset.uri, {
        uploadType:       FileSystem.FileSystemUploadType.MULTIPART,
        fieldName:        'file',
        mimeType:         asset.mimeType || 'image/jpeg',
        parameters: {
          api_key:   signData.apiKey,
          timestamp: String(signData.timestamp),
          signature: signData.signature,
          folder:    signData.folder,
          public_id: signData.publicId,
          eager:     'q_auto',
        },
        sessionType: FileSystem.FileSystemSessionType.BACKGROUND,
      });

      setProgress(80);

      if (uploadResult.status < 200 || uploadResult.status >= 300) {
        throw new Error(`Cloudinary upload failed: HTTP ${uploadResult.status}`);
      }

      const cloudData = JSON.parse(uploadResult.body);
      const secureUrl = cloudData.secure_url;

      if (!secureUrl) throw new Error('No URL in Cloudinary response');

      // ── Step 4: Confirm with our backend ─────────────────────────────────
      const confirmRes = await fetch(`${API}/api/uploads/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ uploadType, publicId: cloudData.public_id, secureUrl }),
      });
      const confirmData = await confirmRes.json();
      if (!confirmRes.ok) throw new Error(confirmData.error?.message || 'Failed to save upload');

      setProgress(100);
      return { url: secureUrl, uploadType, publicId: cloudData.public_id };

    } catch (err) {
      setError(err.message || 'Upload failed. Please try again.');
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  // Camera capture variant
  const capture = useCallback(async (uploadType, options = {}) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      setError('Camera permission required.');
      return null;
    }

    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: options.allowsEditing !== false,
      aspect:        options.aspect || [4, 3],
      quality:       options.quality || 0.8,
    });

    if (result.canceled || !result.assets?.[0]) return null;

    // Swap in the camera image and call upload logic
    // (reuse the same signing + upload flow)
    setUploading(true);
    setProgress(10);
    setError('');

    try {
      const token = await AsyncStorage.getItem('rr_token');
      const asset = result.assets[0];

      const signRes = await fetch(`${API}/api/uploads/sign`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body:    JSON.stringify({ uploadType }),
      });
      const signData = await signRes.json();
      if (!signRes.ok) throw new Error(signData.error?.message || 'Failed to get upload signature');
      if (signData.mock) { setProgress(100); setUploading(false); return { url: asset.uri, mock: true }; }

      setProgress(40);
      const uploadUrl = `https://api.cloudinary.com/v1_1/${signData.cloudName}/image/upload`;
      const uploadResult = await FileSystem.uploadAsync(uploadUrl, asset.uri, {
        uploadType:  FileSystem.FileSystemUploadType.MULTIPART,
        fieldName:   'file',
        mimeType:    'image/jpeg',
        parameters:  {
          api_key: signData.apiKey, timestamp: String(signData.timestamp),
          signature: signData.signature, folder: signData.folder, public_id: signData.publicId,
        },
      });
      setProgress(80);
      if (uploadResult.status >= 300) throw new Error(`HTTP ${uploadResult.status}`);

      const cloudData = JSON.parse(uploadResult.body);
      const confirmRes = await fetch(`${API}/api/uploads/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ uploadType, publicId: cloudData.public_id, secureUrl: cloudData.secure_url }),
      });
      if (!confirmRes.ok) throw new Error('Failed to save upload');
      setProgress(100);
      return { url: cloudData.secure_url, uploadType };
    } catch (err) {
      setError(err.message || 'Upload failed');
      return null;
    } finally {
      setUploading(false);
    }
  }, []);

  return { upload, capture, uploading, progress, error, setError };
}
