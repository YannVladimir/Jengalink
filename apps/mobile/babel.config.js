// Expo's preset, plus per-icon imports for lucide (see babel/lucide-per-icon.js).
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
    plugins: [require.resolve('./babel/lucide-per-icon')],
  };
};
