/**
 * Pantalla principal de GeoLook.
 *
 * Responsabilidades:
 *  - Mostrar el mapa con la posición actual del usuario.
 *  - Permitir buscar un destino (Google Places) o seleccionarlo con long-press.
 *  - Permitir al usuario elegir el radio de alarma.
 *  - Calcular la distancia al destino en tiempo real (primer plano).
 *  - Iniciar/detener la tarea de background que dispara la alarma.
 *  - Reproducir sonido y vibración cuando el usuario entra en el radio.
 */

import { MaterialIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import * as Haptics from 'expo-haptics';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { getDistance } from 'geolib';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    ActivityIndicator,
    Alert,
    Platform,
    ScrollView,
    StatusBar,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { GooglePlaceDetail, GooglePlacesAutocomplete, GooglePlacesAutocompleteRef } from 'react-native-google-places-autocomplete';
import MapView, { Circle, Marker } from 'react-native-maps';
import { SafeAreaView } from 'react-native-safe-area-context';

// Importar la definición de la tarea para que quede registrada
import { PROXIMITY_TASK_NAME, STORAGE_KEYS } from '@/tasks/proximity-task';

// ─── Tipos ────────────────────────────────────────────────────────────────────

type LatLng = {
  latitude: number;
  longitude: number;
};

type AlarmState = 'idle' | 'active' | 'triggered';

// ─── Constantes ───────────────────────────────────────────────────────────────

const RADIUS_OPTIONS = [
  { label: '500 m', value: 500 },
  { label: '1 km', value: 1000 },
  { label: '1.5 km', value: 1500 },
  { label: '2 km', value: 2000 },
  { label: '5 km', value: 5000 },
];

const DEFAULT_RADIUS = 1000;

// Configurar cómo se muestran las notificaciones cuando la app está en primer plano
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Formatea metros a texto legible: "850 m" o "1.2 km" */
function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

// ─── Componente ───────────────────────────────────────────────────────────────

export default function HomeScreen() {
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [destination, setDestination] = useState<LatLng | null>(null);
  const [selectedRadius, setSelectedRadius] = useState<number>(DEFAULT_RADIUS);
  const [currentDistance, setCurrentDistance] = useState<number | null>(null);
  const [alarmState, setAlarmState] = useState<AlarmState>('idle');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isLoadingLocation, setIsLoadingLocation] = useState(true);

  const mapRef = useRef<MapView>(null);
  const locationWatcherRef = useRef<Location.LocationSubscription | null>(null);
  const placesRef = useRef<GooglePlacesAutocompleteRef>(null);
  const [searchText, setSearchText] = useState('');

  // expo-audio: crea el player una sola vez apuntando al archivo local
  const audioPlayer = useAudioPlayer(require('@/assets/sounds/alarm.wav'));
  const audioStatus = useAudioPlayerStatus(audioPlayer);

  // ─── Inicialización ─────────────────────────────────────────────────────────

  useEffect(() => {
    initializeApp();
    return () => {
      stopLocationWatcher();
      stopAlarmSound();
    };
  }, []);

  async function initializeApp() {
    await requestPermissions();
    try {
      await setAudioModeAsync({
        playsInSilentMode: true,
        shouldPlayInBackground: true,
      });
    } catch (e) {
      console.warn('[GeoLook] setAudioModeAsync no disponible en esta versión:', e);
    }
  }

  async function requestPermissions() {
    const { status: fgStatus } = await Location.requestForegroundPermissionsAsync();
    if (fgStatus !== 'granted') {
      setErrorMsg('Sin permiso de ubicación la app no puede funcionar.');
      setIsLoadingLocation(false);
      return;
    }

    const { status: bgStatus } = await Location.requestBackgroundPermissionsAsync();
    if (bgStatus !== 'granted') {
      Alert.alert(
        'Permiso de background',
        'Para que la alarma funcione con la pantalla apagada, ve a Ajustes → GeoLook → Ubicación y selecciona "Siempre".',
        [{ text: 'Entendido' }]
      );
    }

    const { status: notifStatus } = await Notifications.requestPermissionsAsync();
    if (notifStatus !== 'granted') {
      Alert.alert(
        'Notificaciones desactivadas',
        'Activa las notificaciones para recibir la alerta cuando llegues al destino.',
        [{ text: 'OK' }]
      );
    }

    try {
      const position = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });
      setUserLocation({
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
      });
    } catch (e) {
      setErrorMsg('No se pudo obtener tu ubicación. Verifica el GPS.');
    } finally {
      setIsLoadingLocation(false);
    }
  }

  // ─── Manejo del sonido ──────────────────────────────────────────────────────

  function playAlarmSound() {
    try {
      audioPlayer.loop = true;
      audioPlayer.volume = 1.0;
      if (audioStatus.playing) {
        audioPlayer.seekTo(0);
      } else {
        audioPlayer.play();
      }
    } catch (e) {
      console.warn('[GeoLook] No se pudo reproducir alarm.wav, usando solo vibración.');
    }
  }

  function stopAlarmSound() {
    if (audioStatus.playing) {
      audioPlayer.pause();
    }
  }

  // ─── Watcher de ubicación en primer plano ───────────────────────────────────

  async function startLocationWatcher(dest: LatLng, radius: number) {
    stopLocationWatcher();

    locationWatcherRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.High,
        distanceInterval: 20,
        timeInterval: 10000,
      },
      (position) => {
        const { latitude, longitude } = position.coords;
        setUserLocation({ latitude, longitude });

        const distanceMeters = getDistance(
          { latitude, longitude },
          { latitude: dest.latitude, longitude: dest.longitude }
        );

        setCurrentDistance(distanceMeters);

        setAlarmState((prev) => {
          if (prev === 'active' && distanceMeters <= radius) {
            handleAlarmTriggered(distanceMeters);
            return 'triggered';
          }
          return prev;
        });
      }
    );
  }

  function stopLocationWatcher() {
    if (locationWatcherRef.current) {
      locationWatcherRef.current.remove();
      locationWatcherRef.current = null;
    }
  }

  // ─── Tarea de background ────────────────────────────────────────────────────

  async function startBackgroundTask(dest: LatLng, radius: number) {
    await Promise.all([
      AsyncStorage.setItem(STORAGE_KEYS.DESTINATION, JSON.stringify(dest)),
      AsyncStorage.setItem(STORAGE_KEYS.RADIUS, String(radius)),
      AsyncStorage.setItem(STORAGE_KEYS.ALARM_ACTIVE, 'true'),
      AsyncStorage.setItem(STORAGE_KEYS.ALARM_TRIGGERED, 'false'),
    ]);

    const isRegistered = await Location.hasStartedLocationUpdatesAsync(PROXIMITY_TASK_NAME).catch(() => false);
    if (!isRegistered) {
      await Location.startLocationUpdatesAsync(PROXIMITY_TASK_NAME, {
        accuracy: Location.Accuracy.High,
        distanceInterval: 50,
        timeInterval: 15000,
        showsBackgroundLocationIndicator: true,
        foregroundService: {
          notificationTitle: 'GeoLook activo',
          notificationBody: 'Monitoreando proximidad al destino...',
          notificationColor: '#0a7ea4',
        },
        pausesUpdatesAutomatically: false,
      });
    }
  }

  async function stopBackgroundTask() {
    await AsyncStorage.setItem(STORAGE_KEYS.ALARM_ACTIVE, 'false');

    const isRegistered = await Location.hasStartedLocationUpdatesAsync(PROXIMITY_TASK_NAME).catch(() => false);
    if (isRegistered) {
      await Location.stopLocationUpdatesAsync(PROXIMITY_TASK_NAME);
    }
  }

  // ─── Disparar alarma ────────────────────────────────────────────────────────

  const handleAlarmTriggered = useCallback(async (distanceMeters: number) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning);
    playAlarmSound();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: '📍 ¡Llegaste!',
        body: `Estás a ${formatDistance(distanceMeters)} de tu destino.`,
        sound: 'alarm.wav',
        priority: Notifications.AndroidNotificationPriority.MAX,
      },
      trigger: null,
    });
  }, []);

  // ─── Escuchar notificaciones de la tarea background (app en primer plano) ───

  useEffect(() => {
    const subscription = Notifications.addNotificationReceivedListener(() => {
      setAlarmState('triggered');
      playAlarmSound();
    });
    return () => subscription.remove();
  }, [audioStatus.playing]);

  // ─── Acciones del usuario ───────────────────────────────────────────────────

  const handlePlaceSelected = (details: GooglePlaceDetail | null) => {
    if (!details?.geometry?.location) return;

    const newDest: LatLng = {
      latitude: details.geometry.location.lat,
      longitude: details.geometry.location.lng,
    };

    setDestination(newDest);
    setAlarmState('idle');
    setCurrentDistance(null);
    stopAlarmSound();

    mapRef.current?.animateToRegion(
      { ...newDest, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      1500
    );
  };

  const handleLongPress = (e: { nativeEvent: { coordinate: LatLng } }) => {
    const coord = e.nativeEvent.coordinate;
    setDestination(coord);
    setAlarmState('idle');
    setCurrentDistance(null);
    stopAlarmSound();

    mapRef.current?.animateToRegion(
      { ...coord, latitudeDelta: 0.02, longitudeDelta: 0.02 },
      1000
    );
  };

  const handleActivateAlarm = async () => {
    if (!destination) {
      Alert.alert('Falta destino', 'Busca o selecciona un destino en el mapa primero.');
      return;
    }

    setAlarmState('active');
    setCurrentDistance(null);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    await startLocationWatcher(destination, selectedRadius);
    await startBackgroundTask(destination, selectedRadius);
  };

  const handleCancelAlarm = async () => {
    setAlarmState('idle');
    setCurrentDistance(null);
    await stopBackgroundTask();
    stopLocationWatcher();
    stopAlarmSound();
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
  };

  const handleDismissAlarm = async () => {
    await handleCancelAlarm();
    setDestination(null);
  };

  // ─── Render ─────────────────────────────────────────────────────────────────

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" />

      {/* ── Buscador ── */}
      <View style={styles.searchContainer}>
        <GooglePlacesAutocomplete
          ref={placesRef}
          placeholder="Search here..."
          fetchDetails={true}
          onPress={(_data, details = null) => handlePlaceSelected(details)}
          onFail={(error) => console.error('[GooglePlaces] Error:', error)}
          textInputProps={{
            onChangeText: (text) => setSearchText(text),
            clearButtonMode: 'never',
            placeholderTextColor: '#AAAAAA',
          }}
          renderLeftButton={() => (
            <View style={styles.searchIconContainer}>
              <MaterialIcons name="search" size={20} color="#AAAAAA" />
            </View>
          )}
          renderRightButton={() =>
            searchText.length > 0 ? (
              <TouchableOpacity
                style={styles.searchClearButton}
                onPress={() => {
                  placesRef.current?.clear();
                  setSearchText('');
                }}
              >
                <MaterialIcons name="close" size={18} color="#AAAAAA" />
              </TouchableOpacity>
            ) : null
          }
          query={{
            key: process.env.EXPO_PUBLIC_GOOGLE_MAPS_KEY,
            language: 'es',
            components: 'country:co',
          }}
          styles={{
            textInputContainer: styles.textInputContainer,
            textInput: styles.textInput,
            listView: styles.listView,
            description: { fontWeight: 'bold' },
          }}
          enablePoweredByContainer={false}
        />
      </View>

      {/* ── Mapa ── */}
      {isLoadingLocation ? (
        <View style={styles.centerContent}>
          {errorMsg ? (
            <Text style={styles.errorText}>{errorMsg}</Text>
          ) : (
            <>
              <ActivityIndicator size="large" color="#0a7ea4" />
              <Text style={styles.loadingText}>Obteniendo GPS...</Text>
            </>
          )}
        </View>
      ) : (
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          initialRegion={
            userLocation
              ? {
                  latitude: userLocation.latitude,
                  longitude: userLocation.longitude,
                  latitudeDelta: 0.01,
                  longitudeDelta: 0.01,
                }
              : undefined
          }
          onLongPress={handleLongPress}
          showsUserLocation={true}
          showsMyLocationButton={true}
        >
          {destination && (
            <>
              <Marker
                coordinate={destination}
                title="Punto de Alarma"
                description={`Radio: ${formatDistance(selectedRadius)}`}
                pinColor={alarmState === 'triggered' ? 'green' : 'red'}
              />
              <Circle
                center={destination}
                radius={selectedRadius}
                strokeColor={
                  alarmState === 'triggered'
                    ? 'rgba(0, 200, 0, 0.8)'
                    : 'rgba(255, 0, 0, 0.5)'
                }
                fillColor={
                  alarmState === 'triggered'
                    ? 'rgba(0, 200, 0, 0.15)'
                    : 'rgba(255, 0, 0, 0.12)'
                }
                strokeWidth={2}
              />
            </>
          )}
        </MapView>
      )}

      {/* ── Panel inferior ── */}
      {!isLoadingLocation && (
        <View style={styles.bottomPanel}>

          {/* Selector de radio */}
          {alarmState === 'idle' && (
            <>
              <Text style={styles.panelLabel}>Radio de alarma</Text>
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.radiusRow}
              >
                {RADIUS_OPTIONS.map((opt) => (
                  <TouchableOpacity
                    key={opt.value}
                    style={[
                      styles.radiusChip,
                      selectedRadius === opt.value && styles.radiusChipSelected,
                    ]}
                    onPress={() => setSelectedRadius(opt.value)}
                  >
                    <Text
                      style={[
                        styles.radiusChipText,
                        selectedRadius === opt.value && styles.radiusChipTextSelected,
                      ]}
                    >
                      {opt.label}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </>
          )}

          {/* Distancia en tiempo real (cuando la alarma está activa) */}
          {alarmState === 'active' && currentDistance !== null && (
            <View style={styles.distanceRow}>
              <Text style={styles.distanceLabel}>Distancia al destino</Text>
              <Text
                style={[
                  styles.distanceValue,
                  currentDistance <= selectedRadius && styles.distanceValueClose,
                ]}
              >
                {formatDistance(currentDistance)}
              </Text>
              <Text style={styles.distanceHint}>
                Alarma a {formatDistance(selectedRadius)}
              </Text>
            </View>
          )}

          {/* Alarma disparada */}
          {alarmState === 'triggered' && (
            <View style={styles.triggeredRow}>
              <Text style={styles.triggeredText}>📍 ¡Llegaste a tu destino!</Text>
            </View>
          )}

          {/* Botón principal */}
          {alarmState === 'idle' && (
            <TouchableOpacity
              style={[styles.actionButton, !destination && styles.actionButtonDisabled]}
              onPress={handleActivateAlarm}
              disabled={!destination}
            >
              <Text style={styles.actionButtonText}>
                {destination ? '🔔 Activar alarma' : 'Selecciona un destino'}
              </Text>
            </TouchableOpacity>
          )}

          {alarmState === 'active' && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonCancel]}
              onPress={handleCancelAlarm}
            >
              <Text style={styles.actionButtonText}>🔕 Cancelar alarma</Text>
            </TouchableOpacity>
          )}

          {alarmState === 'triggered' && (
            <TouchableOpacity
              style={[styles.actionButton, styles.actionButtonDismiss]}
              onPress={handleDismissAlarm}
            >
              <Text style={styles.actionButtonText}>✓ Cerrar alarma</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </SafeAreaView>
  );
}

// ─── Estilos ──────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  searchContainer: {
    position: 'absolute',
    top: Platform.OS === 'ios' ? 60 : 40,
    width: '94%',
    alignSelf: 'center',
    zIndex: 10,
  },
  textInputContainer: {
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 5,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  textInput: {
    height: 50,
    flex: 1,
    fontSize: 15,
    color: '#11181C',
    backgroundColor: 'transparent',
    marginHorizontal: 0,
    paddingHorizontal: 4,
    elevation: 0,
    shadowOpacity: 0,
  },
  searchIconContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingLeft: 4,
    paddingRight: 2,
  },
  searchClearButton: {
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 10,
    height: 50,
  },
  listView: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    marginTop: 5,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: '#666',
  },
  errorText: {
    color: 'red',
    padding: 20,
    textAlign: 'center',
    fontSize: 15,
  },

  // ── Panel inferior ──────────────────────────────────────────────────────────
  bottomPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: Platform.OS === 'ios' ? 36 : 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.12,
    shadowRadius: 8,
    elevation: 12,
  },
  panelLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#666',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },

  // ── Selector de radio ───────────────────────────────────────────────────────
  radiusRow: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 4,
    marginBottom: 14,
  },
  radiusChip: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#F0F0F0',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  radiusChipSelected: {
    backgroundColor: '#E8F4FD',
    borderColor: '#0a7ea4',
  },
  radiusChipText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#444',
  },
  radiusChipTextSelected: {
    color: '#0a7ea4',
    fontWeight: '700',
  },

  // ── Distancia en tiempo real ────────────────────────────────────────────────
  distanceRow: {
    alignItems: 'center',
    marginBottom: 14,
  },
  distanceLabel: {
    fontSize: 13,
    color: '#666',
    marginBottom: 4,
  },
  distanceValue: {
    fontSize: 36,
    fontWeight: '800',
    color: '#11181C',
    letterSpacing: -1,
  },
  distanceValueClose: {
    color: '#e85d04',
  },
  distanceHint: {
    fontSize: 12,
    color: '#999',
    marginTop: 2,
  },

  // ── Alarma disparada ────────────────────────────────────────────────────────
  triggeredRow: {
    alignItems: 'center',
    marginBottom: 14,
  },
  triggeredText: {
    fontSize: 20,
    fontWeight: '700',
    color: '#2d6a4f',
  },

  // ── Botón de acción ─────────────────────────────────────────────────────────
  actionButton: {
    backgroundColor: '#0a7ea4',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
  },
  actionButtonDisabled: {
    backgroundColor: '#B0B8C1',
  },
  actionButtonCancel: {
    backgroundColor: '#e63946',
  },
  actionButtonDismiss: {
    backgroundColor: '#2d6a4f',
  },
  actionButtonText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
});
