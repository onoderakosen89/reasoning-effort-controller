# Reasoning Effort Controller

**壊れた箇所に早く気づき、次の実装に進む。**

独立した検査の結果を受け、固定モデルへの次の API 呼び出しで推論エフォートを切り替えるローカル HTTP プロキシです。普段は通常時のエフォートで進め、検査で失敗を確認した時に切り替え、同じ検査が通ったら元に戻します。

[English](README.md) · [通信仕様](SPEC.md)

## 試す

Node.js 26.10.0 で実行します。模擬上流とプロキシをローカルで起動し、終了時に閉じます。API キーや実モデルは不要です。

```sh
npm run demo
```

最初は Low。Node.js のテストが実際に落ちると High。同じテストが修正後に通ると Low に戻ります。権限・承認・利用枠・通信の失敗は引き上げに使いません。

## つなぐ

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
