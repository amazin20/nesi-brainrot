// IDs 03–10 are retired. Existing player, cargo and resonator retain 01, 02 and 11.
// preferredSize is the approximate largest world-space dimension, in metres.
export const LAB_ASSETS = Object.freeze([
  { id: 12, file: 'model-12-grand-piano.glb', label: 'Рояль со стулом', role: 'grand-piano', preferredSize: 3.2, originalFilename: 'f8d1c74b83699208cca9d614fd0f2ffc-optimized.glb' },
  { id: 13, file: 'model-13-office-chair.glb', label: 'Офисное кресло', role: 'office-chair', preferredSize: 1.6, originalFilename: '44ece7c59fec856bdfcd9a2377513010-optimized.glb' },
  { id: 14, file: 'model-14-round-table.glb', label: 'Круглый стол', role: 'round-table', preferredSize: 1.8, originalFilename: '32a98635a664a02bcf783ebe5b4eaaeb-optimized.glb' },
  { id: 15, file: 'model-15-mug.glb', label: 'Кружка', role: 'mug', preferredSize: 0.28, originalFilename: 'b7f998f8cbe9e028777649587a3d2609-optimized.glb' },
  { id: 16, file: 'model-16-phase-wall.glb', label: 'Портальная панель', role: 'phase-wall', preferredSize: 4.2, originalFilename: 'eb650579249862cad91466af428cf3ce-optimized(1).glb' },
  { id: 17, file: 'model-17-lab-door.glb', label: 'Дверь лаборатории', role: 'lab-door', preferredSize: 4.4, originalFilename: 'c3cb46ea8988bf881708c8d28bca0f3f-optimized(1).glb' },
  { id: 18, file: 'model-18-pressure-pad.glb', label: 'Нажимная кнопка', role: 'pressure-pad', preferredSize: 2.6, originalFilename: '72c58ff9d5e99e39f937e70d93a4c932-optimized(1).glb' },
  { id: 19, file: 'model-19-lift-platform.glb', label: 'Подъёмная платформа', role: 'lift-platform', preferredSize: 3.8, originalFilename: '55c4fe0c5a524681b805c2f788dcda83-optimized(1).glb' },
  { id: 20, file: 'model-20-energy-barrier.glb', label: 'Энергетический барьер', role: 'energy-barrier', preferredSize: 5.4, originalFilename: '8e5298df19d2b4296c9c6f2bdf46622e-optimized(1).glb' },
  { id: 21, file: 'model-21-launch-pad.glb', label: 'Импульсная площадка', role: 'launch-pad', preferredSize: 3.0, originalFilename: 'fce4f07188eff73c2d94c23f9facf02e-optimized(1).glb' },
  { id: 22, file: 'model-22-terminal.glb', label: 'Терминал', role: 'terminal', preferredSize: 2.0, originalFilename: '0c2933409300b209c72eba89cd0f5524-optimized(2).glb' },
]);

export const CORE_ASSETS = Object.freeze([
  { id: 1, file: 'model-01-player.glb', label: 'Игрок', role: 'player', preferredSize: 2.45 },
  { id: 2, file: 'model-02-cargo.glb', label: 'Брейнрот', role: 'cargo', preferredSize: 1.25 },
  { id: 11, file: 'model-11-portal-gun.glb', label: 'Портальная пушка', role: 'portal-gun', preferredSize: 0.85 },
]);

export const ALL_LAB_ASSETS = Object.freeze([...CORE_ASSETS, ...LAB_ASSETS]);
