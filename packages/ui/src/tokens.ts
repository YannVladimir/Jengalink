// Design tokens: "Safety orange on concrete" (JengaLink Build Plan).
// One source for apps/mobile, apps/web and the PDF report, so all three match.
// Orange is rare on purpose: it always means "tap here" or "needs you".

export const palette = {
  orange50: '#FFF7ED',
  orange100: '#FFEDD5',
  orange200: '#FED7AA',
  orange400: '#FB923C',
  orange500: '#F97316', // Safety Orange (dark-theme accent, never text)
  orange600: '#EA580C', // Safety Orange on light backgrounds (3:1 for marks and dots)
  orange700: '#C2410C', // Jenga Orange (primary)
  orange800: '#9A3412',
  steel50: '#EEF2F7',
  steel100: '#DCE4EE',
  steel700: '#1E3A5F', // Steel Blue
  steel800: '#172E4B',
  steel900: '#0F1F33',
  asphalt: '#1C2430',
  slate: '#5F6B7A',
  slate300: '#8A929E', // placeholders: 3:1 on white (every field also has a visible label)
  concrete: '#F5F3EF',
  concrete200: '#EDEAE4',
  mortar: '#E4DFD7',
  white: '#FFFFFF',
  hiVis: '#FACC15',
} as const;

export interface ColorTheme {
  primary: string;
  primaryPressed: string;
  primarySoft: string;
  onPrimary: string;
  accent: string;
  structure: string;
  structureSoft: string;
  onStructure: string;
  ink: string;
  inkMuted: string;
  inkSubtle: string;
  background: string;
  surface: string;
  surfaceSunken: string;
  border: string;
  borderStrong: string;
  highlight: string;
  focus: string;
  overlay: string;
}

export const colors: ColorTheme = {
  primary: palette.orange700,
  primaryPressed: palette.orange800,
  primarySoft: palette.orange50,
  onPrimary: palette.white,
  accent: palette.orange600,
  structure: palette.steel700,
  structureSoft: palette.steel50,
  onStructure: palette.white,
  ink: palette.asphalt,
  inkMuted: palette.slate,
  inkSubtle: palette.slate300,
  background: palette.concrete,
  surface: palette.white,
  surfaceSunken: palette.concrete200,
  border: palette.mortar,
  // Field and control outlines: 3:1 against white (WCAG 1.4.11).
  borderStrong: '#8D8579',
  highlight: palette.hiVis,
  focus: palette.orange700,
  overlay: 'rgba(28, 36, 48, 0.48)',
};

// Evening use. Every pair is checked against WCAG AA in contrast.test.ts.
export const darkColors: ColorTheme = {
  primary: palette.orange400,
  primaryPressed: palette.orange500,
  primarySoft: '#2A1D14',
  onPrimary: '#1A0F06',
  accent: palette.orange500,
  structure: '#8FB2DB',
  structureSoft: '#1C2836',
  onStructure: '#0B1420',
  ink: '#E8ECF1',
  inkMuted: '#A7B0BC',
  inkSubtle: '#6B7480',
  background: '#12161C',
  surface: '#1B222B',
  surfaceSunken: '#161C24',
  border: '#2A333E',
  borderStrong: '#66707D',
  highlight: palette.hiVis,
  focus: palette.orange400,
  overlay: 'rgba(0, 0, 0, 0.6)',
};

/**
 * Each status has its own colour, icon and word (never colour alone).
 * Approved and Paid never share a colour.
 */
export const statuses = {
  reported: {
    color: '#1D4ED8',
    soft: '#DBEAFE',
    darkColor: '#7AA7FF',
    darkSoft: '#17243D',
    icon: 'camera',
    label: 'Reported',
    meaning: 'Contractor says it is done',
  },
  approved: {
    color: '#1E3A5F',
    soft: '#E3EAF3',
    darkColor: '#9DB9DD',
    darkSoft: '#1C2836',
    icon: 'check-outline',
    label: 'Approved',
    meaning: 'Owner agreed; not paid yet',
  },
  paid: {
    color: '#15803D',
    soft: '#DCFCE7',
    darkColor: '#4ADE80',
    darkSoft: '#13291C',
    icon: 'check-filled',
    label: 'Paid',
    meaning: 'Money verified or work accepted',
  },
  waiting: {
    color: '#B45309',
    soft: '#FEF3C7',
    darkColor: '#FBBF24',
    darkSoft: '#2D2312',
    icon: 'clock',
    label: 'Needs you',
    meaning: 'Waiting for a decision or upload',
  },
  problem: {
    color: '#B91C1C',
    soft: '#FEE2E2',
    darkColor: '#F87171',
    darkSoft: '#321718',
    icon: 'warning',
    label: 'Problem',
    meaning: 'Defect, dispute or variance',
  },
} as const;

export type Status = keyof typeof statuses;
export type StatusIcon = (typeof statuses)[Status]['icon'];

export const fonts = {
  heading: 'Plus Jakarta Sans',
  body: 'Inter',
} as const;

/** Expo Google Fonts registers one family name per weight. */
export const nativeFontFamily = {
  heading600: 'PlusJakartaSans_600SemiBold',
  heading700: 'PlusJakartaSans_700Bold',
  body400: 'Inter_400Regular',
  body500: 'Inter_500Medium',
  body600: 'Inter_600SemiBold',
} as const;

export interface TypeStyle {
  family: 'heading' | 'body';
  weight: 400 | 500 | 600 | 700;
  size: number;
  lineHeight: number;
  letterSpacing?: number;
  tabularNums?: boolean;
}

// Body text is never smaller than 16 on mobile; layouts must survive 200% text.
export const typeScale = {
  display: { family: 'heading', weight: 700, size: 40, lineHeight: 44, letterSpacing: -0.8 },
  screenTitle: { family: 'heading', weight: 700, size: 28, lineHeight: 34, letterSpacing: -0.4 },
  sectionTitle: { family: 'heading', weight: 600, size: 20, lineHeight: 26, letterSpacing: -0.2 },
  body: { family: 'body', weight: 400, size: 16, lineHeight: 24 },
  bodyStrong: { family: 'body', weight: 600, size: 16, lineHeight: 24 },
  label: { family: 'body', weight: 500, size: 14, lineHeight: 20 },
  caption: { family: 'body', weight: 400, size: 13, lineHeight: 18 },
  money: { family: 'body', weight: 600, size: 18, lineHeight: 24, tabularNums: true },
  moneyLarge: { family: 'heading', weight: 700, size: 32, lineHeight: 38, letterSpacing: -0.6, tabularNums: true },
} as const satisfies Record<string, TypeStyle>;

export type TypeVariant = keyof typeof typeScale;

export const nativeFamilyFor = (style: TypeStyle): string => {
  if (style.family === 'heading') {
    return style.weight >= 700 ? nativeFontFamily.heading700 : nativeFontFamily.heading600;
  }
  if (style.weight >= 600) return nativeFontFamily.body600;
  if (style.weight >= 500) return nativeFontFamily.body500;
  return nativeFontFamily.body400;
};

export const spacing = { xxs: 2, xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;
export const radius = { sm: 8, md: 12, lg: 16, xl: 24, pill: 999 } as const;

/** Minimum tap target (WCAG / plan: 44 px or more). Main buttons are 52. */
export const minTouchTarget = 44;
export const mainButtonHeight = 52;

export const elevation = {
  card: { y: 1, blur: 2, opacity: 0.06 },
  raised: { y: 6, blur: 16, opacity: 0.1 },
  sheet: { y: -4, blur: 24, opacity: 0.12 },
} as const;

export const motion = { fast: 120, base: 200, slow: 320 } as const;

/** WCAG contrast ratio of two #RRGGBB colours (1 to 21). */
export function contrastRatio(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => {
      const c = parseInt(hex.slice(i, i + 2), 16) / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
