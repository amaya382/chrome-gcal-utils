<p align="right"><a href="README.md">English</a> / <strong>日本語</strong></p>

<h1 align="center">📅 GCal Utils Chrome Extension</h1>

<p align="center"><strong>カレンダーをいくつ重ねても、Google Calendar を見やすく</strong></p>

> [!WARNING]
> Experimental です。GCal Utils は Google Calendar の非公開のページ構造を読み書きしているため、Google 側の変更で予告なく動かなくなることがあります。

## ✨ Features

- **重複した予定のマージ** — 表示中の複数のカレンダーに入っている会議を、細いチップを横に並べる代わりに 1 つのチップで表示します。自分のカレンダーと指定した優先カレンダーの予定を代表として表示し、カレンダーごとの色帯と、各カレンダーの出欠を並べた hover 一覧で、誰の予定かを確かめられます。優先カレンダーを含まない予定は破線の枠で囲み、各カレンダーの色で均等に塗り分けます。hover 一覧のカレンダーをクリックすると、そのカレンダーの予定を開けます。
- **regex による予定の非表示** — タイトルが pattern にマッチする予定をグリッドから消します。隠した予定があることは、日付ヘッダーの `⊘N` バッジで分かります。
- **空いた場所の再利用** — マージや非表示で消えた予定が使っていた幅や終日行を、残った予定が使うように並べ直します。
- **1 カレンダーだけの表示 (solo)** — サイドバーの `S` ボタンを 1 クリックするとそのカレンダーだけを表示し、もう 1 クリックで直前に表示していたカレンダーに戻します。
- **早朝と深夜の折り畳み** — ほとんど使わない時間帯を、中の予定の件数を添えた細い帯に縮めて、1 日の多くを画面に収めます。

## 🚀 Quick Start

**前提:** Chrome、または Manifest V3 に対応した Chromium 系ブラウザー。

1. このリポジトリを clone する
2. `chrome://extensions/` を開く
3. 「デベロッパー モード」を有効にする
4. 「パッケージ化されていない拡張機能を読み込む」でリポジトリのディレクトリを選ぶ

calendar.google.com を週ビューで開きます。表示中の複数のカレンダーに入っている会議が、1 つのチップになっていれば動いています。インストール前から開いていたタブは再読み込みが必要です。Chrome は、インストール後に読み込んだページにだけ content script を入れるためです。

GCal Utils を止めるには、拡張の popup で各機能を OFF にするか、`chrome://extensions/` から拡張を削除します。

## ⚙️ Configuration

設定はすべて拡張の popup にあり、`chrome.storage.sync` に保存されます。

| 設定 | 既定値 | 内容 |
|---|---|---|
| Merge duplicate events | On | 同じ予定のコピーを 1 つにまとめる |
| Priority calendars | 空 | マージ時に代表にするカレンダーの ID。1 行 1 つで、上ほど優先。自分のカレンダーは常に最優先。ID は hover 一覧に表示される |
| Hide events by regex | On | タイトルが hide pattern にマッチする予定を隠す |
| Solo button on calendar list | On | サイドバーに `S` ボタンを出す |
| Hide patterns | 空 | 1 行 1 つの正規表現。大文字小文字を区別しない |
| Fold early morning and late night | On | 時間グリッドの早朝と深夜を折り畳む |
| Early morning | 8 | 00:00 からこの時刻までを早朝とする。0 で無効 |
| Late night | 20 | この時刻から 24:00 までを深夜とする。24 で無効 |

## 🔒 Permissions

- `storage`：設定、solo の後に戻すカレンダー、展開中の折り畳み範囲の保存

## 🧪 Development

build step も依存パッケージもありません。

テストは Node.js 組み込みのテストランナーで実行します (Node.js 26 で確認)。

```sh
node --test
```

変更を試すには、`chrome://extensions/` で GCal Utils の再読み込みボタンを押してから、Google Calendar のタブを再読み込みします。

## 🔧 Troubleshooting

### 予定がマージされない

- 日、週、カスタム日数ビューのどれかを開いているか確かめる
- popup で「Merge duplicate events」が ON になっているか確かめる
- 拡張のインストールや再読み込みより前から開いていたタブなら、再読み込みする
- 両方のコピーを開いて比べる。event ID が異なるコピーは、タイトルと開始と終了がすべて同じでないとマージしない

### ドラッグした後に予定の位置がずれる

マージや再配置をした予定は、Google のドラッグ処理と位置が合わないことがあります。ドラッグする前に popup で該当する機能を OFF にするか、ドラッグした後にページを再読み込みします。

### solo ボタンが出ない

- popup で「Solo button on calendar list」が ON になっているか確かめる
- 左サイドバーが閉じていれば開く
