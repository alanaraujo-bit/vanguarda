# VANGUARDA — Guerra pelo Núcleo

RTS competitivo para navegador. Invoque unidades, administre energia e destrua o
Núcleo inimigo antes que ele destrua o seu.

100% procedural: **zero assets externos** — toda a arte é desenhada em runtime e
todo o áudio (música e efeitos) é sintetizado com Web Audio API. O jogo carrega
instantaneamente e funciona offline após o primeiro load.

## Como rodar

```bash
npm install
npm run dev
```

Abra a URL exibida (normalmente `http://localhost:5173`) e jogue.

Outros comandos:

| Comando             | Efeito                                   |
| ------------------- | ---------------------------------------- |
| `npm run build`     | Typecheck + build de produção em `dist/` |
| `npm run preview`   | Serve o build de produção                |
| `npm run typecheck` | Apenas verificação de tipos              |
| `npm run pwa:icons` | Regera os ícones (`public/`) a partir de `public/icon.svg` |

## PWA / mobile

O jogo é um PWA instalável (Android e iOS) e funciona **100% offline** após o
primeiro carregamento — o service worker (Workbox, via `vite-plugin-pwa`)
faz cache de todo o app shell no build.

- O service worker só existe no **build de produção**: `npm run dev` não o
  registra. Para testar instalação/offline localmente:
  ```bash
  npm run build
  npm run preview
  ```
  Abra a URL do preview, confira em DevTools → Application → Manifest/Service
  Workers, e teste "Offline" na aba Network.
- **Landscape only:** o design é 1280x720; em celulares num navegador comum
  (não instalado) ou no iOS (que ignora `orientation` do manifest), um aviso
  em CSS pede para girar o aparelho quando a tela está em retrato.
- **Teste em Android real:** com o cabo USB e depuração ativada,
  `adb reverse tcp:4173 tcp:4173` e abra `http://localhost:4173` no Chrome do
  celular — `localhost` é tratado como contexto seguro, então dá pra testar
  instalação e modo avião sem precisar de HTTPS.
- **Teste em iOS real:** o Safari não tem exceção de `localhost` vinda de
  outro dispositivo, então é preciso HTTPS de verdade — hospede em qualquer
  provedor estático (Vercel/Netlify/GitHub Pages) ou use um túnel temporário
  (`ngrok http 4173`) apontando para o preview.
- **Atualizações:** o service worker usa `registerType: 'autoUpdate'` — uma
  aba aberta e ociosa (por exemplo parada no menu) pode recarregar sozinha
  quando uma nova versão é publicada. Aceitável para partidas curtas
  (~3 minutos); não há hoje um aviso de "nova versão disponível".

## Como jogar

- **Objetivo (Contra IA):** destrua o Núcleo inimigo em 3 minutos — ou termine
  com mais HP de base quando o tempo acabar. No último minuto a **Sobrecarga**
  dobra a geração de energia dos dois lados.
- **Energia:** regenera sozinha (máx. 10). Cada unidade custa energia.
- **Invocar:** toque numa carta e depois numa das 3 faixas — ou arraste a carta
  até a faixa. Teclado: `1–8` seleciona a carta, `Q/W/E` invoca na faixa
  superior/central/inferior, `ESC` pausa.
- **Modos:** Treinamento (energia acelerada, dicas), Contra IA (3 dificuldades)
  e Sobrevivência (ondas infinitas, entre no ranking do seu melhor resultado).

### As 8 unidades

| Unidade | Custo | Papel | Counter natural |
| ------- | ----- | ----- | --------------- |
| Faísca  | 2 | Choque corpo a corpo | segura assassinas |
| Enxame  | 3 | 3 drones frágeis | derrete tanques |
| Lâmina  | 3 | Assassina veloz | caça atiradores/artilharia |
| Agulha  | 3 | Tiro de longo alcance | morre para Lâmina |
| Lúmen   | 4 | Cura o aliado mais ferido | sustenta avanços |
| Bastião | 5 | Tanque-muralha | fraco contra enxames |
| Trovão  | 6 | Artilharia em área | apaga enxames |
| Titã    | 8 | Unidade suprema | caro; vulnerável a enxames |

### Progressão

XP por partida → níveis → **skins** (5 cores de esquadrão), **títulos**,
**12 conquistas**, **3 missões diárias** e histórico das últimas partidas.
Tudo persiste em `localStorage`.

## Arquitetura

```
src/
├── main.ts                 Bootstrap do Phaser
├── config/                 Dados e balanceamento (data-driven)
│   ├── constants.ts        Layout, paleta, economia, partida
│   ├── units.ts            As 8 unidades + tabela de counters da IA
│   └── progression.ts      XP, conquistas, skins, títulos, missões
├── core/
│   ├── types.ts            Contratos compartilhados (única fonte de tipos)
│   ├── events.ts           Bus global + assinatura com auto-limpeza
│   └── SaveManager.ts      Persistência do perfil (localStorage)
├── audio/AudioEngine.ts    Música generativa + SFX sintetizados (Web Audio)
├── gfx/TextureFactory.ts   Toda a arte, gerada com Graphics em runtime
├── ui/widgets.ts           Botões, sliders, toggles, painéis
├── entities/
│   ├── Unit.ts             Agente autônomo: avança → engaja → morre
│   ├── Base.ts             Núcleo com torreta defensiva
│   └── Projectile.ts       Voo reto/teleguiado e balístico
├── systems/
│   ├── EnergySystem.ts     Economia (uma instância por lado)
│   ├── BotAI.ts            Defende, faz combos, erra de propósito, adapta
│   ├── WaveDirector.ts     Ondas da Sobrevivência (orçamento crescente)
│   └── Progression.ts      Aplica resultado → XP/conquistas/missões
└── scenes/
    Boot → Menu ⇄ (Profile | Settings)
              └→ Game + Hud → Result
```

### Decisões de projeto

- **Data-driven:** balancear o jogo = editar `config/`; nenhum sistema precisa
  mudar.
- **Desacoplamento por eventos:** HUD e partida conversam pelo bus
  (`core/events.ts`) e pela API pública da `GameScene`.
- **Pronto para multiplayer:** toda ação de jogo passa por um único comando
  (`GameScene.deployUnit(team, unidade, faixa)`), que hoje é chamado pelo
  jogador local e pela `BotAI`. Para multiplayer, basta substituir a fonte
  desses comandos por uma camada de rede — a simulação não precisa mudar.
- **Ranking preparado:** `MatchRecord` já persiste tudo que um leaderboard
  remoto precisa (modo, resultado, onda, dano, duração, data).

### Stack

TypeScript (strict) · Phaser 3 · Vite · Web Audio API · Canvas/WebGL

Phaser 3 foi escolhido por ser o motor 2D mais maduro para web: pipeline
WebGL com fallback para Canvas, gestão de scenes, tweens, partículas e input
multi-touch prontos — exatamente o conjunto que um RTS de navegador exige.
