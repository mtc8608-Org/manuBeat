// Icon-name → ionicon registry, shared by every nav surface.
//
// Nav is declared as data in constants.ts (NAV_AREAS / AREA_NAV), which cannot
// import ionicons without dragging the icon set into a constants module — so
// areas name their icon as a string and it is resolved here. Three consumers:
// AreaShell (in-page rail), Menu (drawer) and anything else rendering AREA_NAV.
//
// An unknown name resolves to undefined, which Ionic renders as a blank slot
// rather than an error — if an icon is missing, check the key matches exactly.
// Adding an area with a new icon means adding its import and one line here.
import {
  trendingUpOutline, barChartOutline,
  clipboardOutline,
  documentTextOutline, folderOutline, constructOutline,
  walletOutline, pulseOutline, gitNetworkOutline, statsChartOutline,
  optionsOutline, layersOutline, briefcaseOutline, downloadOutline,
  peopleOutline, keyOutline, personOutline, settingsOutline,
  bedOutline, hardwareChipOutline,
} from 'ionicons/icons';

export const ICON_MAP: Record<string, string> = {
  'trending-up':     trendingUpOutline,
  'bar-chart':       barChartOutline,
  'clipboard':       clipboardOutline,
  'document-text':   documentTextOutline,
  'folder':          folderOutline,
  'construct':       constructOutline,
  'wallet':          walletOutline,
  'pulse':           pulseOutline,
  'git-network':     gitNetworkOutline,
  'stats-chart':     statsChartOutline,
  'options-outline': optionsOutline,
  'layers-outline':  layersOutline,
  'briefcase':       briefcaseOutline,
  'download':        downloadOutline,
  'people':          peopleOutline,
  'key':             keyOutline,
  'person':          personOutline,
  'settings':        settingsOutline,
  // [BEDSIDE] Data Collection area — flagged for upstream (flag-upstream), so
  // these two lines should arrive from manuSpine on a later merge and this
  // comment can go with them.
  'bed':             bedOutline,
  'hardware-chip':   hardwareChipOutline,
};

export default ICON_MAP;
