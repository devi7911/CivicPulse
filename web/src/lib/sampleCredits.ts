// Attribution for the free-licence sample photos in web/public/samples (required by CC BY / BY-SA).
export interface PhotoCredit { author: string; license: string; licenseUrl: string; source: string }

const BY_SA_4 = 'https://creativecommons.org/licenses/by-sa/4.0/';

const CREDITS: Record<string, PhotoCredit> = {
  'samples/water.jpg': { author: 'Nickw25', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:Burst_Water_Main_in_Melbourne_July_2019.jpg' },
  'samples/pothole.jpg': { author: 'Savant dev', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:Roads_in_Bihar_have_potholes.jpg' },
  'samples/lights.jpg': { author: 'PattayaPatrol', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:DZ6_2616_A_quiet_dimly_lit_alley_at_night_with_streetlights_casting_long_shadows_along_shuttered_shopfronts.jpg' },
  'samples/garbage.jpg': { author: 'Joxemai', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:Cluttered_dustbin_donostia_2015_12.JPG' },
  'samples/swing.jpg': { author: 'Donald Trung Quoc Don', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:Unchained_swing,_Provenierswijk,_Rotterdam_(2023)_02.jpg' },
  'samples/manhole.jpg': { author: 'Bart Everson', license: 'CC BY 2.0', licenseUrl: 'https://creativecommons.org/licenses/by/2.0/', source: 'https://commons.wikimedia.org/wiki/File:Open_Manhole_and_Cover_Mid-City_New_Orleans.jpg' },
  'samples/swing-fixed.jpg': { author: 'Baltimore Heritage', license: 'CC0', licenseUrl: 'https://creativecommons.org/publicdomain/zero/1.0/', source: 'https://commons.wikimedia.org/wiki/File:Swing_set,_Collington_Square_Playground,_1409_N._Patterson_Park_Avenue,_Baltimore,_MD_21213_(47450321102).jpg' },
  'samples/cleanup-bags.jpg': { author: 'Aspulgas', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:Lixo_recolhido_pela_Brigada_do_Mar_6.jpg' },
  'samples/health-camp-bp.jpg': { author: 'Pöllö', license: 'CC BY-SA 3.0', licenseUrl: 'https://creativecommons.org/licenses/by-sa/3.0/', source: 'https://commons.wikimedia.org/wiki/File:Measurement_of_blood_pressue_in_arm.jpg' },
  'samples/manhole-fixed.jpg': { author: 'Recher009', license: 'CC BY-SA 4.0', licenseUrl: BY_SA_4, source: 'https://commons.wikimedia.org/wiki/File:Kanaldeckel_in_Chandigarh.jpg' },
};

export function creditsFor(...paths: (string | null | undefined)[]): PhotoCredit[] {
  const seen = new Set<string>();
  return paths.flatMap((p) => (p && CREDITS[p] && !seen.has(p) && seen.add(p) ? [CREDITS[p]] : []));
}
