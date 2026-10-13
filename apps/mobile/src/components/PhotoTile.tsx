import type { PhotoView } from '@jengalink/contracts';
import { radius } from '@jengalink/ui';
import { useJengaTheme } from '@jengalink/ui/native';
import { View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// Placeholder art for site photos until real media exists: a stylised build in
// six palettes, so the photo strip reads as photos without shipping images.
const tones = [
  { sky: ['#CFE0F0', '#EEF3F8'], wall: '#B9A58C', slab: '#8E8A84', accent: '#C2410C' },
  { sky: ['#F4DCC4', '#FBF0E4'], wall: '#C9B293', slab: '#7E7A73', accent: '#1E3A5F' },
  { sky: ['#D6E4D2', '#F0F5EE'], wall: '#A9977E', slab: '#8B8680', accent: '#F97316' },
  { sky: ['#DDD5EA', '#F3F0F8'], wall: '#BCA98F', slab: '#77736C', accent: '#C2410C' },
  { sky: ['#E9E1C9', '#F8F4E8'], wall: '#B49C7E', slab: '#86827B', accent: '#1E3A5F' },
  { sky: ['#CDE3E6', '#EDF5F6'], wall: '#C2AE92', slab: '#807C75', accent: '#F97316' },
];

export function PhotoTile({
  photo,
  size,
  width,
  height,
}: {
  photo: PhotoView;
  size?: number;
  width?: number;
  height?: number;
}) {
  const { dark } = useJengaTheme();
  const w = width ?? size ?? 96;
  const h = height ?? size ?? 96;
  const t = tones[photo.tone % tones.length];
  const id = `sky${photo.id}`;
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel={`Photo: ${photo.caption}`}
      style={{ width: w, height: h, borderRadius: radius.md, overflow: 'hidden', opacity: dark ? 0.85 : 1 }}
    >
      <Svg width={w} height={h} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid slice">
        <Defs>
          <LinearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0" stopColor={t.sky[0]} />
            <Stop offset="1" stopColor={t.sky[1]} />
          </LinearGradient>
        </Defs>
        <Rect width="100" height="100" fill={`url(#${id})`} />
        <Rect x="0" y="78" width="100" height="22" fill={t.slab} opacity="0.55" />
        <Rect x="18" y="44" width="58" height="36" fill={t.wall} />
        <Rect x="26" y="52" width="10" height="12" fill={t.slab} opacity="0.7" />
        <Rect x="44" y="52" width="10" height="12" fill={t.slab} opacity="0.7" />
        <Rect x="62" y="56" width="8" height="24" fill={t.slab} opacity="0.8" />
        <Rect x="14" y="38" width="66" height="7" fill={t.slab} />
        <Rect x="82" y="20" width="3" height="60" fill={t.accent} />
        <Rect x="58" y="20" width="27" height="3" fill={t.accent} />
      </Svg>
    </View>
  );
}
