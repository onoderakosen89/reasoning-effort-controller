# Reasoning Effort Controller の通信仕様

信頼するローカルの呼び出し元が検査結果を渡し、プロキシが固定したモデルへの次の HTTP リクエストのエフォートを設定する。
対象は `POST /v1/chat/completions` と `POST /v1/responses`。

## 呼ぶ側の契約 v1

`X-Effort-Context` に UTF-8 JSON を base64url にした値を付ける。最大 8 KiB。
router はこの予約headerを上流へ送らない。本文の metadata や tool文字列からこの情報を作らない。

```json
{"v":1,"run_id":"run-unique","call_id":"call-unique","seq":1,"observations":[]}
```

- run_id: アダプタが実行開始時に生成する UUID 等。sessionの再開でも別実行は別ID。同じ本文の別実行も別ID。
- call_id: 論理モデル呼出ごとのID。HTTP再送は同じID・seq・本文・観測を保持する。
- seq: run内で1から連続する整数。新しい論理呼出だけ増やす。異なるrunは並行可。同runは順序を保証する。
- observations: 前回から増えた構造化結果の配列（最大64）。全並列tool結果を、アダプタが関連づけて渡す。
- IDは1–80文字の `[A-Za-z0-9_-]`。メッセージ本文や機密を入れない。

```json
{"id":"event-a","check_id":"unit-suite","outcome":"failure","category":"reasoning"}
{"id":"event-b","check_id":"unit-suite","outcome":"success","resolves":"event-a"}
{"id":"event-c","check_id":"read-file","outcome":"success"}
{"id":"event-d","check_id":"tool-b","outcome":"failure","category":"permission"}
{"id":"event-e","check_id":"tool-c","outcome":"unknown"}
```

category は `reasoning|approval|permission|quota|transport|unknown`。
`reasoning` は呼ぶ側の検査器が推論や生成結果に起因する失敗と分類できた時だけ使う。
非zero exit code 単体ではこの分類を証明しない。分類不能は unknown。
再検査成功は元の failure event ID と同じ check_id を示す。
同じbatch内のfailureを同じbatch内のsuccessで取り消さない。再検査は後の論理呼出に渡す。
未提供・不正な情報を「成功」と補わない。

この header は認証ではなく、信頼するローカル呼出側との契約。公開・複数tenant用ではない。
モデル自身が observation を生成して検査結果になりすます構成には接続しない。

## 状態と再送

状態は run_id ごと。初回は通常時の値（`--base-effort`、既定は `low`）。
reasoning failure が1つでも未解決なら失敗時の値（`--failure-effort`、既定は `high`）。
全未解決 failure に対応する再検査が成功した時に通常時の値に戻る。
単なる読み取り成功・最後のtoolだけの成功・文字列FAILED・同じtoolの繰返しは状態の切替の根拠にしない。
approval/permission/quota/transport/unknown は未解決推論failureを増やさず、既存の失敗状態も解除しない。

同じ call_id の再送は元の判断を使い、観測を再適用しない。これはHTTP応答のキャッシュではない。
上流への再送はそのまま通るので、上流実行のexactly-onceを保証しない。
本文hashは同じIDの衝突検出に限って使い、実行を識別するためには使わない。
再送の本文や観測が違う、seqが飛ぶ・巻き戻る、eventのIDが違う意味で再利用された場合は未判定で原文を通す。
同時到着の同じcallは、通信開始前の同期した判断で1回だけ状態を更新する。

状態はメモリのみ。最大256run、runごと256call・256event。満杯は原文透過で `capacity` を記録。
古いrunを勝手に忘れて新しい初回と扱わない。再起動後は新run IDで開始する。
プロセスを越える再送の重複排除と再開は未実装で、実運用導入前の判断事項。

## 透明性と通信

適用対象は method/path/model/context/JSON の条件が揃った時だけ。
JSONを全面的にserializeし直さず、effortの値の範囲のみ差し替える（欠損ならfieldを追加）。
Responsesでは reasoning のほかの子fieldも保持する。未知のfield、大きい数値、文字列のescape、空白、順序を保持する。
重複JSON key、UTF-8不正、不正JSON、圧縮body、2 MiB超のbody、既存reasoningがobject以外なら原文透過。
対象外本文はバイト一致。検査で上限を越えた本文は先読み分を戻し、残りをstreamで送る。

上流originは明示した `http://127.0.0.1:PORT` のみ。requestのpathとqueryはそのまま。
Host と framing は接続先と本文長に合わせる。hop-by-hop header と Connection指定headerは取り除く。
Authorization等のend-to-end headerは転送するが記録しない。リダイレクトは追跡せずそのまま返す。
WebSocket upgrade と CONNECT は本試作の範囲外（501）。HTTP trailerの保存も対象外。

SSEは加工・集約せず上流chunkをpipeしbackpressureを伝える。
client切断では上流request/responseをdestroyする。上流切断は下流にも伝え、成功したSSE終端を捏造しない。
接続からの全体timeoutを既定120秒、無通信timeoutを既定30秒。CLIで調整可。
timeout前にheader未送信なら504、その他の接続障害は502。送信済みならsocket切断。
自動retryしない。通信障害をeffortの不足には数えない。
request body受信にも全体timeoutを適用する。

## 記録と観測の限界

stdoutに1要求1JSON行。run/call/seq、適用effort、理由、未解決数、再送、HTTP status、所要ms、
通信の終了状態を記録。本文・Authorization・応答内容・URL queryは記録しない。
構造化したreason codeで判断を追える。unknown と passthrough は明記する。
SSE/response bodyを解釈しないため、tokenはrouterログからは測れない。
実モデルの利用量、品質、キャッシュヒット率を比較する場合は、呼び出し側で別途計測する。
