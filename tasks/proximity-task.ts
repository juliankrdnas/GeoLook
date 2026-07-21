/**
 * Tarea de background para monitoreo de proximidad.
 *
 * Esta tarea es registrada por expo-task-manager y se ejecuta en segundo plano
 * cada vez que el SO entrega una actualización de ubicación, incluso cuando la
 * app está minimizada o la pantalla está apagada.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import * as TaskManager from 'expo-task-manager';
import { getDistance } from 'geolib';

export const PROXIMITY_TASK_NAME = 'GEOLOOK_PROXIMITY_TASK';

// Claves de AsyncStorage para compartir estado entre la tarea y la UI
export const STORAGE_KEYS = {
  DESTINATION: 'geolook_destination',
  RADIUS: 'geolook_radius',
  ALARM_ACTIVE: 'geolook_alarm_active',
  ALARM_TRIGGERED: 'geolook_alarm_triggered',
};

/**
 * Definición de la tarea. Debe llamarse en el nivel raíz del módulo,
 * fuera de cualquier componente o función, para que expo-task-manager
 * pueda registrarla al iniciar la app.
 */
TaskManager.defineTask(PROXIMITY_TASK_NAME, async ({ data, error }) => {
  if (error) {
    console.error('[ProximityTask] Error recibido:', error.message);
    return;
  }

  if (!data) return;

  const { locations } = data as { locations: Location.LocationObject[] };
  if (!locations || locations.length === 0) return;

  const currentLocation = locations[locations.length - 1];

  try {
    // Leer el estado guardado por la UI en AsyncStorage
    const [destRaw, radiusRaw, alarmActiveRaw, alarmTriggeredRaw] = await Promise.all([
      AsyncStorage.getItem(STORAGE_KEYS.DESTINATION),
      AsyncStorage.getItem(STORAGE_KEYS.RADIUS),
      AsyncStorage.getItem(STORAGE_KEYS.ALARM_ACTIVE),
      AsyncStorage.getItem(STORAGE_KEYS.ALARM_TRIGGERED),
    ]);

    // Si la alarma no está activa o ya se disparó, no hacer nada
    if (alarmActiveRaw !== 'true' || alarmTriggeredRaw === 'true') return;

    if (!destRaw || !radiusRaw) return;

    const destination = JSON.parse(destRaw) as { latitude: number; longitude: number };
    const radius = parseInt(radiusRaw, 10);

    const distanceMeters = getDistance(
      { latitude: currentLocation.coords.latitude, longitude: currentLocation.coords.longitude },
      { latitude: destination.latitude, longitude: destination.longitude }
    );

    console.log(`[ProximityTask] Distancia al destino: ${distanceMeters}m (radio: ${radius}m)`);

    if (distanceMeters <= radius) {
      // Marcar como disparada para no repetir la notificación
      await AsyncStorage.setItem(STORAGE_KEYS.ALARM_TRIGGERED, 'true');

      // Enviar notificación local que funciona con pantalla apagada
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '📍 ¡Llegaste!',
          body: `Estás a ${distanceMeters}m de tu destino. ¡Es hora de bajarte!`,
          sound: 'alarm.wav',
          priority: Notifications.AndroidNotificationPriority.MAX,
          vibrate: [0, 500, 200, 500, 200, 500],
        },
        trigger: null, // Inmediata
      });
    }
  } catch (e) {
    console.error('[ProximityTask] Error procesando ubicación:', e);
  }
});
