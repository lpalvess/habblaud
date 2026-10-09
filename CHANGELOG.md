# Novidades

O que entrou em cada versão do Habblaud. Cada versão tem a sua seção aqui, e o texto dela vira as notas da
[release no GitHub](https://github.com/marmottajr/habblaud/releases) (`npm run release`), que o Habblaud abre em
**Configurações › Sobre › Ver o que mudou**.

O formato segue o [Keep a Changelog](https://keepachangelog.com/pt-BR/1.1.0/), e os números seguem o
[versionamento semântico](https://semver.org/lang/pt-BR/): correção sobe o último número (0.2.**1**), novidade sobe o
do meio (0.**3**.0).

## [Não lançado]

### Adicionado

- Verificação automática no GitHub (Actions): a cada push na `main` e a cada pull request, o projeto roda
  `typecheck`, testes e build no Node 22.12, a versão mínima que o `package.json` declara.

### Corrigido

- Quando um arquivo de transcript era apagado e outro, maior, era criado no lugar, o Habblaud podia não perceber a
  troca: alguns sistemas de arquivos reaproveitam o número (inode) do arquivo apagado, e só o inode era comparado.
  Agora, quando o sistema informa o momento de criação do arquivo, ele também entra na comparação, e a leitura
  recomeça do início do arquivo novo.

## [0.4.0] - 2026-10-08

### Alterado

- **O CodeTown agora se chama Habblaud.** O nome muda em toda parte: interface, logotipo, placa da recepção, totem da
  entrada, prévia de link, repositório (`github.com/marmottajr/habblaud`), marketplace e plugins do Claude Code
  (`habblaud` e `habblaud-permissoes`, com o comando `/habblaud`), variáveis de ambiente (`HABBLAUD_*`), pasta de
  estado (`~/.habblaud`) e Docker (container e imagem `habblaud`, volume `habblaud-data`).
- Para quem vem do CodeTown: rode `npm run mod:install` uma vez (troca o marketplace e os plugins antigos pelos novos
  em cada conta) e `npm run docker:up` (tira o container antigo e copia os nomes, a linha do tempo e as estatísticas
  do volume `codetown_codetown-data` para o novo, sem apagar o antigo). A pasta `~/.codetown` e as preferências e
  moedinhas guardadas no navegador passam para os nomes novos sozinhas. As variáveis `CODETOWN_*` não valem mais:
  renomeie para `HABBLAUD_*` no `.env` (o servidor e o `docker:up` avisam). Detalhes no README, em
  "Vindo do CodeTown".

## [0.3.2] - 2026-10-08

### Corrigido

- Quando um terminal fechava e a sala dele era desmontada, ficava um jardim no meio do prédio, entre salas. Agora a
  sala mais distante se muda para a vaga: é montada lá, ainda apagada; o primeiro a chegar acende a luz e cada um
  volta para a mesma mesa. O endereço antigo apaga e é desmontado, e o prédio encolhe. Uma sala que abre ocupa a
  primeira vaga livre, e a carga inicial já vem sem buracos.
- Quem estava a caminho de algo que deixou de existir, como o bebedouro de uma coluna do corredor que sumiu quando o
  prédio encolheu, era teletransportado. Agora muda de plano e segue andando.

## [0.3.1] - 2026-10-08

### Corrigido

- Quem cochilava na mesa (ocioso há mais de 10 minutos) e levantava para uma roda, uma festa ou um passeio saía
  andando com o "zzz" na cabeça. Agora o "zzz" só aparece enquanto o personagem dorme.

## [0.3.0] - 2026-10-08

### Adicionado

- **Mod do Habblaud para o Claude Code** (2.1.287 ou mais novo): `npm run mod:install` instala, em cada conta, o
  marketplace desta pasta com o mod `habblaud` (uso de 5 horas e semanal ao vivo, uma linha no terminal quando outra
  sessão precisa de você e o comando `/habblaud`) e o plugin `habblaud-permissoes` (responder permissões pelo
  escritório; `-- --sem-permissoes` deixa de fora). `npm run mod:status` mostra o que cada conta tem e
  `npm run mod:uninstall` tira tudo. O `npm run docker:up` atualiza o mod de quem já instalou.

### Mudado

- O tap de statusline (`npm run usage:install`) e o hook de permissão (`npm run hooks:install`) viram o jeito antigo,
  para o Claude Code anterior ao 2.1.287. O `npm run mod:install` tira os dois da conta (com backup), porque o mod faz
  o mesmo. A interface e o README passam a ensinar o `npm run mod:install`.
- O script do hook de permissão mudou para `mod/habblaud-permissoes/hooks/permission-hook.mjs`. O caminho antigo
  (`scripts/permission-hook.mjs`) virou um atalho, então quem instalou o hook antes continua funcionando.
- Em Contas e uso, a origem dos números diz quando vêm do mod ("ao vivo (mod do Habblaud)").
- O leitor do uso ao vivo ignora um arquivo lido pela metade e fica com o último número bom, em vez de esconder a
  conta por um ciclo.

## [0.2.0] - 2026-10-08

Primeira versão publicada.

### Adicionado

- **Versão e atualizações:** a versão em uso aparece na barra superior e em Configurações › Sobre. A cada 6 horas o
  Habblaud confere as releases no GitHub; quando sai uma versão nova, aparece o selo **Nova versão**, com um aviso e o
  link do que mudou. `HABBLAUD_UPDATE_CHECK=0` desliga a consulta.
- **Meu dia** (tecla M): para onde foi o tempo dos agentes, quanto tempo esperaram você, tokens e custo, com 30 dias
  de histórico.
- **GitHub no escritório:** PR aberto ou mergeado e release publicada viram festa na sala; CI vermelho liga o alarme,
  até um CI verde.
- **Responder pelo escritório** (tecla P): com o hook instalado (`npm run hooks:install`), aprovar, recusar ou
  "sempre permitir" pedidos de permissão sem ir ao terminal. Só com acesso local.
- **Timelapse do dia** (tecla L): o escritório reproduz o dia em alta velocidade.
- **Terminal somente leitura** (tecla T): a conversa de cada agente, ao vivo, no estilo do Claude Code, com busca,
  filtro, botão de copiar e histórico das sessões dos últimos 7 dias. Só com acesso local.
- **Dia e noite** pela hora local e **sons** sintetizados no navegador (desligados por padrão).
- **Vida social:** quem está à toa se junta em rodas (TV, videogame, pingue-pongue, papo na copa, jokenpô valendo
  moedinhas), com personalidades, amizades e rivalidades.
- **Esperando o shell:** o agente que espera um comando longo fica na mesa com a ampulheta, e a espera vira uma gag.
- Forks de sessão aparecem no escritório.
- A página aberta se recarrega sozinha quando o servidor passa a servir outra versão.
- O container usa o fuso horário do computador.
- **O escritório:** cada projeto aberto no Claude Code vira uma sala e cada sessão, um personagem com nome próprio.
  Subagentes chegam, trabalham e entregam ao principal. Mostra as duas contas, com o uso de 5 horas e semanal de
  cada uma (tap de statusline), além de feed de atividade, avisos e modo demonstração. Roda no Node ou no Docker local.

[Não lançado]: https://github.com/marmottajr/habblaud/compare/v0.4.0...HEAD
[0.4.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.4.0
[0.3.2]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.2
[0.3.1]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.1
[0.3.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.3.0
[0.2.0]: https://github.com/marmottajr/habblaud/releases/tag/v0.2.0
