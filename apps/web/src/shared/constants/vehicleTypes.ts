export type VehicleTypeId = 'largus' | 'light' | 'truck6m' | 'eurotruck';

export type VehicleType = {
  id: VehicleTypeId;
  name: string;
  volumeM3: number;
  payloadTons: number;
};

export const VEHICLE_TYPES: readonly VehicleType[] = [
  { id: 'largus', name: 'Ларгус', volumeM3: 2.35, payloadTons: 0.8 },
  { id: 'light', name: 'Газель', volumeM3: 12, payloadTons: 1.8 },
  { id: 'truck6m', name: 'Грузовик 6м', volumeM3: 38, payloadTons: 5 },
  { id: 'eurotruck', name: 'Фура', volumeM3: 92, payloadTons: 22 },
] as const;

export const DEFAULT_VEHICLE_ID: VehicleTypeId = 'truck6m';

export function findVehicleType(id: string | null | undefined): VehicleType {
  return (
    VEHICLE_TYPES.find((v) => v.id === id) ??
    VEHICLE_TYPES.find((v) => v.id === DEFAULT_VEHICLE_ID) ??
    VEHICLE_TYPES[0]!
  );
}
