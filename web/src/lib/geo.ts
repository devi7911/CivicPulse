// Locality name for a pin (e.g. "Madhapur"), from OpenStreetMap Nominatim reverse geocoding.
// Used to group reports by area. Failure is fine: the report is saved without an area.
export async function areaFor(lat: number, lng: number): Promise<string | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=en&lat=${lat.toFixed(5)}&lon=${lng.toFixed(5)}`, { signal: ctrl.signal });
    clearTimeout(t);
    if (!res.ok) return null;
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    const name = a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || a.town || null;
    return name && name.length >= 2 ? name.slice(0, 60) : null;
  } catch {
    return null;
  }
}

export interface AddressParts {
  houseNumber: string;
  building: string;
  street: string;
  area: string;
  city: string;
  pincode: string;
}

// Structured address guess for a pin, from OpenStreetMap Nominatim reverse geocoding. Used to
// prefill the "complete your profile" address fields. Failure is fine: the form stays blank.
export async function reverseGeocodeAddress(lat: number, lng: number): Promise<AddressParts | null> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=en&lat=${lat.toFixed(6)}&lon=${lng.toFixed(6)}`,
      { signal: ctrl.signal },
    );
    clearTimeout(t);
    if (!res.ok) return null;
    const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
    return {
      houseNumber: a.house_number ?? '',
      building: a.building && a.building !== 'yes' ? a.building : (a.amenity ?? ''),
      street: a.road || a.pedestrian || a.residential || '',
      area: a.suburb || a.neighbourhood || a.quarter || a.city_district || a.village || '',
      city: a.city || a.town || 'Hyderabad',
      pincode: a.postcode ?? '',
    };
  } catch {
    return null;
  }
}

// Short clips only: at most 30 seconds and 25 MB, checked before upload.
export const MAX_VIDEO_SECONDS = 30;
export const MAX_VIDEO_BYTES = 25 * 1024 * 1024;
export const VIDEO_TYPES = ['video/mp4', 'video/webm', 'video/quicktime'];

export function videoDuration(file: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const v = document.createElement('video');
    v.preload = 'metadata';
    const url = URL.createObjectURL(file);
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(v.duration); };
    v.onerror = () => { URL.revokeObjectURL(url); reject(new Error('This video could not be read. Try an MP4 file.')); };
    v.src = url;
  });
}
