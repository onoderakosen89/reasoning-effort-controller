# Test Feedback Loop

**AI 開発を速くするには、壊れた変更を早く見つける。**

プログラミング未経験から AI でシステムを作る中で、実装の速さと堅牢さの両方に効いたのが、PDCA の **C（検査）を短く回すこと**でした。壊れた箇所と期待する挙動が分かれば、AI に任せる修正が小さくなります。そこで Low を起点にし、同じ検査で直ったかを確かめます。

[English](README.md) · [Agent Skill](skills/test-feedback-loop/SKILL.md)

## 検査から始める作り方

1. **再現する。** 何が通ればよいかを決め、異常例と正常例を一つずつ試します。
2. **小さく直す。** 失敗した検査、期待した結果、実際の結果を Codex や Claude Code に渡します。直す範囲を絞れたら、まず Low を使います。
3. **同じ検査で確かめる。** 異常例が直り、正常例も保たれたことを見ます。原因を絞れず次の修正が推測になるなら、証拠を残して止まります。

実案件の写しでは、会話の開始前に送った発言が落ちる不具合を再現し、Codex が Low の1ターンで修正しました。独立した再検査で、落ちていた発言が戻り、正常な発言の扱いも保たれました。固定 High との所要時間・トークンの差は未比較です。

## 自分のプロジェクトで確かめる

Node.js 26.10.0 で、信頼できるテストファイルを指定します。

```sh
npm run check:node -- --cwd /path/to/project --check-id regression --id before test/regression.test.mjs
```

結果と、失敗したアサーションの場所が出ます。終了値は合格が `0`、アサーション失敗が `1`、未確認が `2` です。修正後は同じファイル・検査IDで `--id after --resolves before` を付けて実行します。モデルや API キーは不要です。台本から使う場合は `npm run --silent check:node -- --json` に検査の引数を足し、返る `observation` を `RunContext` に渡せます。

## 独立検査を持ち寄る

pytest、Vitest、TypeScript、Cargo、スキーマ検証などで使っている検査を募集します。失敗する最小例、通る再検査、試験結果を確定できない例を添えて、[検査の提案 Issue](https://github.com/onoderakosen89/reasoning-effort-controller/issues/new?template=check-adapter.yml) に出せます。動くアダプタがある場合は、同じ例を試験にして PR にできます。[参加ガイド](CONTRIBUTING.md)

現在同梱しているのは Node.js の検査アダプタです。

## 任意のエフォート切り替え

検査と修正の手順は固定 Low でも使えます。切り替えを試す場合は、同梱の HTTP プロキシか、Codex と Claude Code の接続例を選べます。[通信仕様](SPEC.md)

### 切り替えのデモ

Node.js 26.10.0 で実行します。模擬上流とプロキシをローカルで起動し、終了時に閉じます。API キーや実モデルは不要です。

```sh
npm run demo
```

最初は Low。Node.js のテストが実際に落ちると High。同じテストが修正後に通ると Low に戻ります。権限・承認・利用枠・通信の失敗は引き上げに使いません。

### Codex で直接試す

Codex CLI が入っていれば、`npm run demo:codex` で App Server を起動し、同じスレッドの3ターンで模擬上流に **Low → High → Low** が届くことを確認できます。HTTP プロキシのデモと同じ検査器・切り替え条件を使います。

普段の ChatGPT ログインで試す場合は `npm run demo:codex -- --chatgpt` です。ログイン方法を確認してから、一時の読み取り用作業場所で Codex を3回呼びます。モデルを変える場合は `--model MODEL_ID` を追加できます。この例は専用の App Server セッションを開きます。[Codex App Server の仕様](https://developers.openai.com/codex/app-server)

### Claude Code で直接試す

公式の Claude Code CLI に本人のアカウントでログインした状態で、`npm run demo:claude -- --use-subscription` を実行します。独立検査の結果に応じて `--effort` を設定し、同じ会話を `--resume` で引き継ぎながら3回呼びます。認証とモデル通信は公式 CLI が扱います。[Claude Code CLI の仕様](https://code.claude.com/docs/en/cli-reference)

### デスクトップで使う

開いているデスクトップ会話では、実装後に検査を実行し、結果を見てアプリのエフォート設定から次の値を選べます。上の自動例はそれぞれ専用のセッションで動きます。[Codex の設定](https://learn.chatgpt.com/docs/models?surface=app) · [Claude Desktop の設定](https://code.claude.com/docs/en/desktop)

### HTTP プロキシにつなぐ

```sh
npm start -- --upstream http://127.0.0.1:8317 --model YOUR_MODEL_ID --port 8318
```

呼び出し側の API の基点を `http://127.0.0.1:8318/v1` にし、`src/adapter.mjs` の `RunContext` で検査結果を渡します。実行と再検査の ID の扱いは [通信仕様](SPEC.md) にあります。

起動時に通常時（`--base-effort`、既定は `low`）と、確認済みの失敗が残る間（`--failure-effort`、既定は `high`）の値を指定できます。対応する再検査がすべて通ると通常時の値に戻ります。

| 切り替え | 起動オプション |
| --- | --- |
| High → Low → High | `--base-effort high --failure-effort low` |
| Low → XHigh → Low | `--base-effort low --failure-effort xhigh` |

指定できる値は `none`、`minimal`、`low`、`medium`、`high`、`xhigh`、`max` です。上流のモデルが対応する値を選んでください。

### 同梱の Node.js 検査

`src/checkers/node-test.mjs` の `runNodeTestCheck` にテストファイルと検査IDを渡すと、`RunContext` に渡せる結果を返します。アサーションの失敗は Node.js の構造化イベントで判定します。試験を実行できない場合や理由を分類できない場合は不明として扱います。再検査では同じファイルと検査IDを使い、元の失敗IDを `resolves` に渡します。[接続例](README.md#bundled-nodejs-check)

対象はローカルの信頼できる呼び出し元です。検査、仕事の停止、結果の報告は呼び出し元の役目です。状態はメモリにあり、上流への二重実行を防ぐ機能はありません。実モデルの品質、所要時間、トークン節約は未測定です。

```sh
npm test
npm run test:integration
```
