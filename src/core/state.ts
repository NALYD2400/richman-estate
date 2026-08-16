/**
 * État partagé entre modules (remplace les Object.defineProperty(window, ...)
 * du découpage historique de main.js). Les mutations via state.X sont visibles
 * partout — ne stocker ici que les données réellement partagées.
 */
export const state = {
  // Vitrines publiques
  publicVehiclesList: [] as any[],
  publicSuitesList: [] as any[],
  onlyFavoritesFilter: false,

  // Pagination
  currentFleetPage: 1,
  currentSuitesPage: 1,
  suitesPerPage: 24 as number | 'all',

  // Catalogues admin
  allVehicles: [] as any[],
  allSuites: [] as any[],
  allBookingsList: [] as any[],
  usersCache: null as any,

  // Divers
  uploadedImagesArray: [] as string[],
  uploadedSuiteImagesArray: [] as string[],
  cardActiveSlideMap: new Map<string, number>()
};
