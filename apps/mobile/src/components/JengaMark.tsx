import { useJengaTheme } from '@jengalink/ui/native';
import Svg, { Rect } from 'react-native-svg';

/** Brand mark: three stacked blocks, the top one orange. */
export function JengaMark({ size = 32 }: { size?: number }) {
  const { colors } = useJengaTheme();
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" accessibilityElementsHidden>
      <Rect x={4} y={21} width={24} height={7} rx={2} fill={colors.structure} />
      <Rect x={4} y={12.5} width={24} height={7} rx={2} fill={colors.structure} opacity={0.7} />
      <Rect x={9} y={4} width={19} height={7} rx={2} fill={colors.primary} />
    </Svg>
  );
}
