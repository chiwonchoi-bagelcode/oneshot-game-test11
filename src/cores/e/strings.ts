// Core e strings (KO/EN): rule cards (mech.<key>.title/body), coach lines, tray labels.
// Coach lines: e.coach.<stage coach key>.start (before the first drop), .first (right after it),
// .due (guided stages: the moment the clock stops for the next drop).
export default {
  ko: {
    'mech.e_first.title': '첫 방울 자리',
    'mech.e_first.body': '반짝이는 곳이 첫 잉크 자리예요. 거기서 번지는 잉크를 보고 다음 잉크를 정해요.',
    'mech.e_mix.title': '색 섞기',
    'mech.e_mix.body': '두 색이 같은 박자에 같은 칸에 닿으면 섞여서 새 색이 돼요.',
    'mech.e_count.title': '도착 숫자',
    'mech.e_count.body': '칸 위 숫자는 잉크가 닿기까지 남은 박자예요. 숫자가 거리와 같을 때 떨어뜨리면 같이 닿아요.',
    'mech.e_race.title': '먼저 닿기',
    'mech.e_race.body': '칸에 점선 테두리가 깜빡이면 다른 색이 오고 있다는 뜻이에요. 숫자가 다 줄기 전에 맞는 색이 먼저 닿게 해요.',

    'e.reject.first': '첫 잉크는 반짝이는 곳에 떨어뜨려요',
    'e.guide.first': '여기에 첫 잉크',
    'e.guide.wait': '기다려요',
    'e.coach.markHint': '반짝이는 곳에 첫 잉크를 떨어뜨려요',

    'e.coach.s1.start': '반짝이는 곳에 첫 잉크를 떨어뜨려요',
    'e.coach.s1.first': '잉크가 박자마다 한 칸씩 번져요',
    'e.coach.s2.start': '노랑은 반짝이는 곳에서 시작해요',
    'e.coach.s2.first': '파랑을 떨어뜨려 노랑과 만나게 해요',
    'e.coach.s3.start': '초록 칸의 숫자는 노랑이 닿기까지 남은 박자예요',
    'e.coach.s3.first': '파랑 자리는 초록 칸에서 2칸. 숫자가 2가 될 때까지 기다려요',
    'e.coach.s3.due': '숫자가 2예요. 지금 파랑을 떨어뜨려요',
    'e.coach.s4.first': '노랑 자리에서 주황 칸까지 칸 수가 숫자와 같을 때 떨어뜨려요',

    // The original rules, told in this version's words (overrides the shared cards in this build).
    'mech.walls.body': '잉크는 돌담을 넘지 못하고 돌아서 번져요. 칸 위 숫자는 돌아가는 길까지 세어 줘요.',
    'mech.white.body': '점선 칸에는 잉크가 닿으면 안 돼요. 숫자가 뜨면 그 박자 전에 다른 잉크로 길을 막아요.',
    'mech.three.body': '빨강, 노랑, 파랑을 모두 써요. 칸 색을 보고 어떤 두 색이 만나야 하는지 정해서 차례로 떨어뜨려요.',

    'e.coach.s6.first': '숫자는 돌담을 돌아가는 길까지 세어 줘요',
    'e.coach.s8.first': '점선 칸은 파랑 자리예요. 빨강보다 먼저 닿게 해요',
    'e.coach.s11.first': '짧은 노랑은 2칸까지만 번져요. 주황 칸 가까이에 떨어뜨려요',
    'e.coach.s13.first': '빨강이 비워 둘 칸으로 가고 있어요. 파랑으로 길을 막아요',
    'e.coach.s15.first': '주황 칸에선 노랑이, 보라 칸에선 파랑이 빨강을 만나요',
  } as Record<string, string>,
  en: {
    'mech.e_first.title': 'The first drop',
    'mech.e_first.body': 'The glowing spot is where the first ink goes. Watch it spread, then decide where the next ink goes.',
    'mech.e_mix.title': 'Mixing',
    'mech.e_mix.body': 'When two colors reach the same cell on the same beat, they mix into a new color.',
    'mech.e_count.title': 'Arrival numbers',
    'mech.e_count.body': 'A number on a cell counts the beats until ink gets there. Drop when the number equals the distance and both arrive together.',
    'mech.e_race.title': 'Get there first',
    'mech.e_race.body': 'A blinking dotted frame means the wrong color is on its way. Get the right color there before the number runs out.',

    'e.reject.first': 'The first ink goes on the glowing spot',
    'e.guide.first': 'First ink here',
    'e.guide.wait': 'Wait',
    'e.coach.markHint': 'Drop the first ink on the glowing spot',

    'e.coach.s1.start': 'Drop the first ink on the glowing spot',
    'e.coach.s1.first': 'Ink spreads one cell every beat',
    'e.coach.s2.start': 'Yellow starts on the glowing spot',
    'e.coach.s2.first': 'Drop blue so it meets the yellow',
    'e.coach.s3.start': 'The number on the green cell counts the beats until yellow gets there',
    'e.coach.s3.first': 'Blue starts 2 cells from the green cell. Wait until the number shows 2',
    'e.coach.s3.due': 'It shows 2. Drop blue now',
    'e.coach.s4.first': 'Drop yellow when the number matches its distance to the orange cells',

    'mech.walls.body': 'Ink can’t cross stone walls, so it flows around them. The numbers count the way around too.',
    'mech.white.body': 'Dotted cells must stay clean. When a number shows up there, block the way with other ink before then.',
    'mech.three.body': 'Red, yellow and blue together. Each cell’s color tells you which two inks must meet there.',

    'e.coach.s6.first': 'The numbers count the way around the wall',
    'e.coach.s8.first': 'The dotted cell wants blue. Get there before red does',
    'e.coach.s11.first': 'Short yellow spreads only 2 cells. Drop it near the orange cells',
    'e.coach.s13.first': 'Red is heading for the clean cells. Block it with blue',
    'e.coach.s15.first': 'Yellow meets red on orange, blue meets red on purple',
  } as Record<string, string>,
};
