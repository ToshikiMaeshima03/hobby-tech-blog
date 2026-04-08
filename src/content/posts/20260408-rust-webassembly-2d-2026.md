---
title: "Rust＋WebAssemblyで作る2Dゲームエンジン完全ガイド【2026年版】"
description: "Rust×WebAssemblyで高速な2Dゲームエンジンを実装する方法を解説。Bevy、wasm-bindgen、ECSアーキテクチャまで実装コード付きで網羅。"
category: "game-dev"
tags: ["Rust", "WebAssembly", "ゲームエンジン", "Bevy", "2D"]
publishedAt: 2026-04-08
featured: false
---

## なぜ今、Rust + WebAssemblyで2Dゲームエンジンを作るのか

ブラウザゲーム開発において、JavaScriptのパフォーマンス限界は常に課題でした。複雑な物理演算、大量のスプライト描画、リアルタイム処理——これらを実現するには、ネイティブコードに近い実行速度が必要です。

Rust + WebAssembly (WASM) の組み合わせは、この課題を解決する最有力候補です。Rustのメモリ安全性と高速性、WebAssemblyのブラウザネイティブ実行環境が融合することで、**従来のJavaScript実装の2〜10倍のパフォーマンス**を実現できます。

2026年現在、BevyやMacroquadといった主要Rustゲームエンジンは公式にWASM対応し、wasm-bindgenも活発にメンテナンスされています（[最終更新: 2026年3月31日](https://github.com/wasm-bindgen/wasm-bindgen)）。

この記事では、Rust + WASMで実用的な2Dゲームエンジンを構築するための技術選定から実装まで、実際のコード例とともに解説します。

## 2026年版: Rust 2Dゲームエンジンの選択肢

[2026年2月時点での主要エンジン比較](https://aarambhdevhub.medium.com/rust-game-engines-in-2026-bevy-vs-macroquad-vs-ggez-vs-fyrox-which-one-should-you-actually-use-9bf93669e83f)では、以下のエンジンがWASMサポートを提供しています。

### Bevy 0.18 — ECS×高性能レンダリング

[Bevy](https://bevy-cheatbook.github.io/platforms/wasm.html)は2026年最も注目されるRustゲームエンジンです。データ駆動型ECS（Entity Component System）設計により、2Dレンダリングは他の選択肢と比較して**2倍高速**です。

**特徴:**
- Windows/macOS/Linux/WebAssemblyのワンソースマルチプラットフォーム対応
- WebGPU/WebGLバックエンド自動切り替え
- 強力な2D/3D統合レンダリング
- アセット管理・物理エンジン統合

**制約:**
- WASMはシングルスレッド（マルチスレッドサポートは未実装）
- ネイティブコードより10〜30%低速

### Macroquad 0.4.14 — 軽量Web最適化

[Macroquad](https://arewegameyet.rs/ecosystem/engines/)は、WebAssembly対応に特化した軽量エンジンです。

**特徴:**
- 最小限の依存関係（ビルド時間が短い）
- シンプルなAPI（`draw_texture()`など直感的）
- WASM向けに最適化された設計

**適用シーン:**
- プロトタイプ開発
- シンプルな2Dゲーム（パズル、アクション）

### wasm-game-engine — フルスクラッチECS実装

[ar-saeedi/wasm-game-engine](https://github.com/ar-saeedi/wasm-game-engine)は、Rust + WASMの学習に最適な実装例です。

**含まれる機能:**
- WebGLレンダリングパイプライン
- ECSアーキテクチャ
- 2D物理エンジン
- JavaScriptフォールバック機構

**用途:**
- エンジン内部構造の理解
- カスタムエンジン開発のベース

## Bevy + WASMで作る実装ガイド

ここでは、最も実用的な選択肢であるBevyを使った実装手順を示します。

### 環境構築

```bash
# Rust環境（1.75以降）
rustup update stable

# WASMターゲット追加
rustup target add wasm32-unknown-unknown

# wasm-bindgen-cli（バージョンはCargo.tomlと一致させる）
cargo install wasm-bindgen-cli --version 0.2.92

# ローカルサーバー（動作確認用）
cargo install basic-http-server
```

### プロジェクトセットアップ

```bash
cargo new wasm_2d_game
cd wasm_2d_game
```

**Cargo.toml:**

```toml
[package]
name = "wasm_2d_game"
version = "0.1.0"
edition = "2021"

[dependencies]
bevy = { version = "0.18", default-features = false, features = [
    "bevy_winit",
    "bevy_render",
    "bevy_core_pipeline",
    "bevy_sprite",
    "webgl2",
] }

[profile.release]
opt-level = 'z'     # サイズ最適化
lto = true          # リンク時最適化
codegen-units = 1   # ビルド最適化
```

### 基本的な2Dスプライトレンダリング

**src/main.rs:**

```rust
use bevy::prelude::*;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(WindowPlugin {
            primary_window: Some(Window {
                title: "Rust WASM 2D Game".to_string(),
                resolution: (800., 600.).into(),
                canvas: Some("#bevy".to_string()), // HTML Canvas ID
                ..default()
            }),
            ..default()
        }))
        .add_systems(Startup, setup)
        .add_systems(Update, move_sprite)
        .run();
}

#[derive(Component)]
struct Player {
    speed: f32,
}

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
) {
    commands.spawn(Camera2dBundle::default());

    commands.spawn((
        SpriteBundle {
            texture: asset_server.load("player.png"),
            transform: Transform::from_xyz(0., 0., 0.),
            ..default()
        },
        Player { speed: 200.0 },
    ));
}

fn move_sprite(
    time: Res<Time>,
    keyboard: Res<ButtonInput<KeyCode>>,
    mut query: Query<(&mut Transform, &Player)>,
) {
    for (mut transform, player) in &mut query {
        let mut direction = Vec3::ZERO;

        if keyboard.pressed(KeyCode::ArrowLeft) {
            direction.x -= 1.0;
        }
        if keyboard.pressed(KeyCode::ArrowRight) {
            direction.x += 1.0;
        }
        if keyboard.pressed(KeyCode::ArrowUp) {
            direction.y += 1.0;
        }
        if keyboard.pressed(KeyCode::ArrowDown) {
            direction.y -= 1.0;
        }

        if direction.length() > 0.0 {
            direction = direction.normalize();
        }

        transform.translation += direction * player.speed * time.delta_seconds();
    }
}
```

### WASMビルド＆デプロイ

```bash
# WASMビルド
cargo build --release --target wasm32-unknown-unknown

# wasm-bindgen実行
wasm-bindgen --out-dir ./out/ --target web \
    ./target/wasm32-unknown-unknown/release/wasm_2d_game.wasm

# assetsディレクトリをコピー
cp -r assets ./out/
```

**index.html（out/に配置）:**

```html
<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <title>Rust WASM 2D Game</title>
    <style>
        body { margin: 0; overflow: hidden; }
        canvas { width: 100%; height: 100vh; display: block; }
    </style>
</head>
<body>
    <canvas id="bevy"></canvas>
    <script type="module">
        import init from './wasm_2d_game.js';
        init();
    </script>
</body>
</html>
```

**ローカル実行:**

```bash
basic-http-server out/
# http://127.0.0.1:4000 でアクセス
```

## ECSアーキテクチャで実装する物理エンジン

Bevyの強みは、データ駆動型ECSによる効率的なゲームロジック実装です。ここでは、簡易的な重力・衝突判定システムを実装します。

```rust
use bevy::prelude::*;

#[derive(Component)]
struct Velocity {
    value: Vec2,
}

#[derive(Component)]
struct Gravity {
    force: f32,
}

fn apply_gravity(
    time: Res<Time>,
    mut query: Query<(&mut Velocity, &Gravity)>,
) {
    for (mut velocity, gravity) in &mut query {
        velocity.value.y -= gravity.force * time.delta_seconds();
    }
}

fn apply_velocity(
    time: Res<Time>,
    mut query: Query<(&mut Transform, &Velocity)>,
) {
    for (mut transform, velocity) in &mut query {
        transform.translation.x += velocity.value.x * time.delta_seconds();
        transform.translation.y += velocity.value.y * time.delta_seconds();
    }
}

// main()に追加
.add_systems(Update, (apply_gravity, apply_velocity).chain())
```

**使用例（ジャンプ機能追加）:**

```rust
fn setup(mut commands: Commands, asset_server: Res<AssetServer>) {
    commands.spawn(Camera2dBundle::default());

    commands.spawn((
        SpriteBundle {
            texture: asset_server.load("player.png"),
            ..default()
        },
        Player { speed: 200.0 },
        Velocity { value: Vec2::ZERO },
        Gravity { force: 980.0 }, // 重力加速度（px/s²）
    ));
}

fn jump_system(
    keyboard: Res<ButtonInput<KeyCode>>,
    mut query: Query<&mut Velocity, With<Player>>,
) {
    if keyboard.just_pressed(KeyCode::Space) {
        for mut velocity in &mut query {
            velocity.value.y = 400.0; // ジャンプ初速
        }
    }
}

// main()に追加
.add_systems(Update, jump_system)
```

## パフォーマンス最適化のベストプラクティス

### 1. WASMバイナリサイズ削減

```toml
# Cargo.toml
[profile.release]
opt-level = 'z'       # サイズ優先最適化
lto = true            # リンク時最適化
strip = true          # デバッグシンボル削除
codegen-units = 1     # ビルド時間 vs サイズトレードオフ
panic = 'abort'       # unwinding削除
```

**wasm-optによる追加圧縮:**

```bash
# wasm-opt（Binaryen）インストール
# Debian/Ubuntu
sudo apt install binaryen

# macOS
brew install binaryen

# 実行
wasm-opt -Oz -o out/wasm_2d_game_bg_opt.wasm \
    out/wasm_2d_game_bg.wasm
```

### 2. アセット遅延ロード

```rust
use bevy::prelude::*;

#[derive(Resource, Default)]
struct GameAssets {
    player: Option<Handle<Image>>,
    enemy: Option<Handle<Image>>,
}

fn load_assets(
    mut assets: ResMut<GameAssets>,
    asset_server: Res<AssetServer>,
) {
    assets.player = Some(asset_server.load("player.png"));
    assets.enemy = Some(asset_server.load("enemy.png"));
}

fn spawn_player(
    mut commands: Commands,
    assets: Res<GameAssets>,
) {
    if let Some(texture) = &assets.player {
        commands.spawn(SpriteBundle {
            texture: texture.clone(),
            ..default()
        });
    }
}
```

### 3. スプライトバッチング

Bevyは自動的にスプライトをバッチ処理しますが、以下の条件で効率化されます:

- 同一テクスチャ使用
- 同一Z座標レイヤー
- 同一シェーダー

**最適化例（テクスチャアトラス使用）:**

```rust
use bevy::sprite::TextureAtlas;

fn setup(
    mut commands: Commands,
    asset_server: Res<AssetServer>,
    mut texture_atlases: ResMut<Assets<TextureAtlas>>,
) {
    let texture_handle = asset_server.load("spritesheet.png");
    let texture_atlas = TextureAtlas::from_grid(
        texture_handle,
        Vec2::new(32.0, 32.0), // タイルサイズ
        8, 8,                  // 8x8グリッド
        None, None,
    );
    let atlas_handle = texture_atlases.add(texture_atlas);

    // アトラスからスプライト生成
    commands.spawn(SpriteSheetBundle {
        texture_atlas: atlas_handle.clone(),
        sprite: TextureAtlasSprite::new(0), // インデックス0のタイル
        ..default()
    });
}
```

## JavaScript連携: wasm-bindgenによる高度な統合

[wasm-bindgen](https://rustwasm.github.io/docs/wasm-bindgen/)を使うと、RustとJavaScript間で双方向の関数呼び出しが可能です。

### JavaScriptからRust関数を呼ぶ

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn calculate_damage(base: f32, multiplier: f32) -> f32 {
    base * multiplier * 1.5
}

#[wasm_bindgen]
pub struct GameState {
    score: u32,
}

#[wasm_bindgen]
impl GameState {
    #[wasm_bindgen(constructor)]
    pub fn new() -> GameState {
        GameState { score: 0 }
    }

    pub fn add_score(&mut self, points: u32) {
        self.score += points;
    }

    pub fn get_score(&self) -> u32 {
        self.score
    }
}
```

**JavaScript側:**

```javascript
import init, { calculate_damage, GameState } from './wasm_2d_game.js';

async function run() {
    await init();

    const damage = calculate_damage(100, 1.5);
    console.log(`Damage: ${damage}`); // 225

    const game = new GameState();
    game.add_score(100);
    console.log(`Score: ${game.get_score()}`); // 100
}

run();
```

### RustからJavaScript APIを呼ぶ

```rust
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);

    #[wasm_bindgen(js_namespace = localStorage)]
    fn setItem(key: &str, value: &str);

    #[wasm_bindgen(js_namespace = localStorage)]
    fn getItem(key: &str) -> Option<String>;
}

pub fn save_score(score: u32) {
    setItem("highscore", &score.to_string());
    log(&format!("Score saved: {}", score));
}

pub fn load_score() -> u32 {
    getItem("highscore")
        .and_then(|s| s.parse().ok())
        .unwrap_or(0)
}
```

## まとめ: Rust + WASMゲームエンジン開発の要点

この記事で解説した技術をまとめます:

- **エンジン選定**: 2026年現在、[Bevy 0.18](https://bevy-cheatbook.github.io/platforms/wasm.html)が最も実用的（高性能×豊富な機能）
- **ビルド最適化**: `opt-level='z'`, `lto=true`, wasm-optで50〜70%のサイズ削減が可能
- **ECS設計**: データ駆動アーキテクチャにより、保守性とパフォーマンスを両立
- **JavaScript連携**: [wasm-bindgen](https://github.com/wasm-bindgen/wasm-bindgen)で既存Webエコシステムとシームレスに統合
- **パフォーマンス**: テクスチャアトラス、遅延ロード、バッチ処理でネイティブコードに近い速度を実現

Rust + WebAssemblyは、ブラウザゲーム開発における新しいスタンダードとなりつつあります。この記事のコード例をベースに、高性能な2Dゲームエンジン開発に挑戦してみてください。

---

**Sources:**
- [Are we game yet? - Game Engines](https://arewegameyet.rs/ecosystem/engines/)
- [Rust Game Engines in 2026: Bevy vs Macroquad vs ggez vs Fyrox](https://aarambhdevhub.medium.com/rust-game-engines-in-2026-bevy-vs-macroquad-vs-ggez-vs-fyrox-which-one-should-you-actually-use-9bf93669e83f)
- [Bevy WebAssembly - Unofficial Bevy Cheat Book](https://bevy-cheatbook.github.io/platforms/wasm.html)
- [wasm-bindgen GitHub](https://github.com/wasm-bindgen/wasm-bindgen)
- [The wasm-bindgen Guide](https://rustwasm.github.io/docs/wasm-bindgen/)
- [wasm-game-engine](https://github.com/ar-saeedi/wasm-game-engine)