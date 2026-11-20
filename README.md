# Eventos em Palmas - TO

Catálogo para eventos em Palmas em cinco seções: **Espaços**, **Buffet e comida**, **Brinquedos e recreação**, **Serviços** (foto, DJ, decoração, cerimonial…) e **Aluguéis e barraquinhas** (pipoca, algodão-doce, food truck, mesas, tendas…). Cada cadastro tem valores com condição, o que está incluso, detalhes da categoria, pagamento, cancelamento, contato e fotos. Dá para avaliar cada opção (nota por critério, prós, contras, orçamento recebido) e comparar até 4 lado a lado.

Tocar num brinquedo ou item abre a ficha dele (foto, valor, descrição, tempo de uso, quem aluga e as outras lojas que têm o mesmo), não a da loja. No evento, Brinquedos e Aluguéis guardam o brinquedo escolhido (`escolhas[].obj` = nome do item na empresa), não só a locadora.

Em **Brinquedos** e **Aluguéis** o cadastro é por empresa, com a lista do que ela aluga (cada brinquedo ou item com tipo, valor, quantidade e observação). O catálogo mostra essas seções **por empresa** ou **por brinquedo/item**, e o filtro de tipo encontra as empresas que têm aquele objeto.

As fotos de espaços que vieram do Google Maps ficam em `fotos/<id>/maps-N.jpg`. Cada foto guarda o crédito (`credito.nome` e `credito.url`), e a ficha do espaço mostra "Fotos: Google Maps" com link para a página de origem.

A ficha também mostra um mapa (OpenStreetMap) com o ponto em `coordenadas` e, se a pessoa permitir, a distância em linha reta até onde ela está. A posição fica só na memória da aba: não é salva nem enviada. `coordenadas.aprox: true` marca pontos que só acertam a quadra.

**Meus eventos** organiza o planejamento: data, horário, para quem, quem organiza, convidados, tema, orçamento e descrição. Em cada evento você adiciona as opções de cada categoria, marca com a estrela as melhores e acompanha valor combinado, pago e vencimentos, um orçamento detalhado (itens como lembrancinhas e doces ficam em rascunho e só contam como gasto depois de aprovados), tarefas com prazo e cronograma do dia, tudo numa página só (com versão para imprimir).

Os campos de cada categoria vieram da pesquisa em [docs/pesquisa-atributos.md](docs/pesquisa-atributos.md).

Site: https://geisbelly.github.io/locais-eventos-palmas/

Sem login para ver o catálogo. Cadastrar, editar e gravar avaliações também não pedem chave: tudo é salvo direto na nuvem. A **chave de edição** (ícone de nuvem) é pedida para **excluir** um cadastro e para abrir os **eventos**.

O convite tem uma página de **avisos e instruções** (`convite.avisos`, um por linha, e `convite.avisos_titulo`), aberta por um botão em destaque; no modelo próprio o botão vai onde estiver `{{avisos}}`. Tirar um convidado da lista também apaga a resposta dele.

Os eventos têm contatos, lista de convidados, idades, orçamento e gastos, por isso a API só entrega e grava eventos e a lista de respostas para quem manda a chave. Sem a chave, o site some com a cópia que o navegador tenha guardado. O convite usa `GET /convite/:evento`, que devolve só o que o convidado vê: título, data, horário, tema, quem organiza, os campos do convite, os presentes (com quais já foram reservados, sem dizer por quem) e, quando o link traz `c=`, o nome e os lugares daquele convidado. O convidado grava a própria resposta sem chave, mas só para um evento que existe, sem excluir e sem mudar de evento. Não existe modo de salvar só no aparelho; o navegador guarda apenas uma cópia para reenviar se a conexão cair.

## Onde ficam os dados

| O quê | Onde | Custo |
|---|---|---|
| Locais (nome, preços, contato…) | `data/locais.json` neste repositório | R$ 0 |
| Fornecedores (buffet, brinquedos, serviços, aluguéis) | `data/fornecedores.json` | R$ 0 |
| Cadastros e edições feitos pelo site, e os eventos | Cloudflare D1 (tabela `registros`). Vale a versão mais nova entre o banco e o JSON | R$ 0 |
| Visitas, prós, contras, anotações | Cloudflare D1 via Worker (pasta `worker/`) | R$ 0 no plano gratuito (5 GB, 100 mil gravações/dia) |
| Sem Worker configurado | `localStorage` do navegador + backup em arquivo | R$ 0 |

## Adicionar ou corrigir

Pelo site: escolha a seção e use **+ Cadastrar**, ou **Editar** (lápis) dentro de um cadastro. **Excluir** só esconde da lista.

Para espaços, pelo site: O formulário tem o que vem no aluguel (piscina, mesas e cadeiras com quantidade, churrasqueira, limpeza…), valores com condição, taxas, horários, contato e fotos. **Remover** só esconde o local da lista.

Ou edite `data/locais.json` direto. O que vem fica em `itens` (`true` ou a quantidade):

```json
"itens": { "piscina": true, "mesas": 20, "cadeiras": 80, "limpeza": true }
```

Cada preço leva a condição:

```json
"precos": [
  { "valor": 400, "unidade": "diária", "condicao": "Segunda a quinta", "inclui": "Piscina e churrasqueira" },
  { "valor": 600, "unidade": "diária", "condicao": "Sexta a domingo", "inclui": "Piscina e churrasqueira" }
]
```

Outros campos: `horarios` (`[{ "dias": "Sáb e dom", "horario": "8h às 2h" }]`), `fotos` (`[{ "url": "fotos/orla-1.jpg", "legenda": "Píer" }]`, com as imagens na pasta `fotos/`), `coordenadas` (`{ "lat": -10.18, "lng": -48.33 }`), `fontes` e `conferido_em`.

## Ligar a nuvem (Cloudflare, gratuito)

Uma vez só, no terminal, dentro de `worker/`:

```bash
npm install
npx wrangler login
npx wrangler d1 create locais-eventos-palmas
```

Cole o `database_id` que aparecer em `worker/wrangler.toml`, depois:

```bash
npx wrangler d1 execute locais-eventos-palmas --remote --file schema.sql
npx wrangler secret put CHAVE_EDICAO
npx wrangler deploy
```

Copie a URL `https://locais-eventos-palmas-api.<sua-conta>.workers.dev` para `apiUrl` em `config.js`, faça commit e push. No site, clique no ícone de nuvem e digite a chave.

## Rodar local

```bash
python3 -m http.server 8080
```
