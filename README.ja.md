# Reasoning Effort Controller

独立した検査の結果を受け、固定モデルへの次の API 呼び出しで推論エフォートを切り替えるローカル HTTP プロキシです。

[English](README.md) · [通信仕様](SPEC.md)

## 試す

Node.js 26.10.0 で実行します。模擬上流とプロキシをローカルで起動し、終了時に閉じます。API キーや実モデルは不要です。

```sh
npm run demo
```

最初は Low。検査で生成物の問題を確かめると High。同じ検査に通ると Low に戻ります。権限・承認・利用枠・通信の失敗は引き上げに使いません。

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

対象はローカルの信頼できる呼び出し元です。検査、仕事の停止、結果の報告は呼び出し元の役目です。状態はメモリにあり、上流への二重実行を防ぐ機能はありません。実モデルの品質、所要時間、トークン節約は未測定です。

```sh
npm test
npm run test:integration
```
