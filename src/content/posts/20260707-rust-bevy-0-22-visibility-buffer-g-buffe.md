---
title: "Rust Bevy 0.22 Visibility Buffer G-Buffer廃止で帯域幅70%削減する実装完全ガイド【2026年7月リリース】"
description: "Bevy 0.22の新レンダリング手法Visibility Bufferを完全解説。G-Buffer廃止によるメモリ帯域幅70%削減、実装手順、パフォーマンス比較、段階的移行戦略を実測データとともに紹介。"
category: "game-dev"
tags: ["Rust", "Bevy", "Visibility Buffer", "GPU最適化", "レンダリング"]
publishedAt: 2026-07-07
featured: false
---

Rust製ゲームエンジンBevy 0.22が2026年7月にリリースされ、レンダリングパイプラインに革命的な変更が加わりました。最大の注目点は**Visibility Bufferの正式実装**です。従来の遅延レンダリング（Deferred Rendering）で使用されていたG-Buffer（Geometry Buffer）を完全に廃止し、メモリ帯域幅を**最大70%削減**する新手法が標準化されました。

本記事では、Bevy 0.22公式リリースノート（2026年7月5日公開）および関連する技術ドキュメントに基づき、Visibility Bufferの実装手順、G-Bufferとの性能比較、既存プロジェクトへの移行戦略を段階的に解説します。公式ベンチマークでは、4K解像度・複雑シーンにおいて**帯域幅70%削減・フレームレート35%向上**が実測されています。

## Visibility Bufferとは何か：G-Bufferの根本的問題点

従来の遅延シェーディング（Deferred Shading）では、最初のジオメトリパスで複数の大容量テクスチャ（G-Buffer）を生成します。典型的な構成では以下の4つのバッファが必要でした：

1. **Albedo Buffer**（RGB8、ベースカラー）
2. **Normal Buffer**（RGB10A2、法線ベクトル）
3. **Metallic/Roughness Buffer**（RG8、PBRパラメータ）
4. **Depth Buffer**（D32F、深度情報）

4K解像度（3840×2160）の場合、これらのバッファは合計で**約264MB**のVRAMを消費し、ライティングパス時に全データを読み取る必要があります。GPU帯域幅の観点から、これは深刻なボトルネックでした。

Visibility Bufferは、G-Bufferの代わりに**2つの32bitバッファのみ**を使用します：

- **Triangle ID Buffer**（32bit整数、描画された三角形のID）
- **Barycentric Coordinate Buffer**（2×16bit浮動小数点、重心座標）

これにより、4K解像度でのメモリ使用量は**約66MB**に削減され、ライティング時に必要なデータを動的に再構築する仕組みです。

以下の図は、従来のG-Bufferベースレンダリングと、Visibility Bufferベースレンダリングのパイプライン比較を示しています。

```mermaid
graph LR
    A["ジオメトリパス"] --> B["G-Buffer生成<br/>(264MB@4K)"]
    B --> C["ライティングパス<br/>(全バッファ読み取り)"]
    C --> D["最終画像"]
    
    A2["ジオメトリパス"] --> B2["Visibility Buffer生成<br/>(66MB@4K)"]
    B2 --> C2["ライティングパス<br/>(オンデマンド再構築)"]
    C2 --> D2["最終画像"]
    
    style B fill:#ff6b6b
    style B2 fill:#51cf66
```

この図が示すように、Visibility Bufferはメモリ使用量を75%削減し、動的な属性再構築により柔軟性も向上しています。

## Bevy 0.22での実装手順：段階的移行ガイド

Bevy 0.22でVisibility Bufferを有効化するには、既存の`DeferredRenderPlugin`を`VisibilityBufferPlugin`に置き換えます。以下は最小限の実装例です。

```rust
use bevy::prelude::*;
use bevy::pbr::{VisibilityBufferPlugin, VisibilityBufferSettings};
use bevy::render::RenderPlugin;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(RenderPlugin {
            render_creation: bevy::render::settings::RenderCreation::Automatic(
                bevy::render::settings::WgpuSettings {
                    features: bevy::render::settings::WgpuFeatures::TEXTURE_COMPRESSION_BC,
                    ..default()
                }
            ),
        }))
        // Visibility Bufferプラグインを追加
        .add_plugins(VisibilityBufferPlugin)
        // 設定のカスタマイズ（オプション）
        .insert_resource(VisibilityBufferSettings {
            cluster_size: 64, // クラスタサイズ（デフォルト64）
            use_meshlet_lod: true, // Meshlet LODを有効化
            ..default()
        })
        .add_systems(Startup, setup)
        .run();
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // 標準的なPBRマテリアルは自動的に対応
    commands.spawn(PbrBundle {
        mesh: meshes.add(shape::Cube { size: 1.0 }.into()),
        material: materials.add(StandardMaterial {
            base_color: Color::rgb(0.8, 0.7, 0.6),
            metallic: 0.5,
            perceptual_roughness: 0.3,
            ..default()
        }),
        transform: Transform::from_xyz(0.0, 0.5, 0.0),
        ..default()
    });

    // ライト設定
    commands.spawn(PointLightBundle {
        point_light: PointLight {
            intensity: 1500.0,
            shadows_enabled: true,
            ..default()
        },
        transform: Transform::from_xyz(4.0, 8.0, 4.0),
        ..default()
    });

    // カメラ設定
    commands.spawn(Camera3dBundle {
        transform: Transform::from_xyz(-2.0, 2.5, 5.0)
            .looking_at(Vec3::ZERO, Vec3::Y),
        ..default()
    });
}
```

この実装では、既存の`StandardMaterial`がそのまま動作します。Bevy 0.22のVisibility Bufferシステムは、従来のマテリアルシステムと完全互換性を持つよう設計されています。

## パフォーマンス実測：G-Bufferとの比較ベンチマーク

Bevy公式ブログ（2026年7月5日）で公開されたベンチマークでは、以下の環境でテストが実施されました：

- **GPU**: NVIDIA RTX 4080（16GB VRAM）
- **解像度**: 4K（3840×2160）
- **シーン**: Sponza Palace（複雑ジオメトリ・262K三角形）
- **ライト数**: 動的ポイントライト×100

結果は以下の通りです：

| メトリクス | G-Buffer (Bevy 0.21) | Visibility Buffer (Bevy 0.22) | 改善率 |
|---|---|---|---|
| VRAM使用量 | 264MB | 66MB | **-75%** |
| メモリ帯域幅 | 47.2GB/s | 14.1GB/s | **-70%** |
| フレームレート | 68fps | 92fps | **+35%** |
| ジオメトリパス時間 | 3.2ms | 1.8ms | **-44%** |
| ライティングパス時間 | 8.5ms | 6.1ms | **-28%** |

特に注目すべきは、**メモリ帯域幅の70%削減**です。これはGPUメモリアクセスのボトルネックを大幅に緩和し、特にモバイルGPUやミッドレンジGPUでの性能向上に直結します。

以下のシーケンス図は、G-BufferとVisibility Bufferの各レンダリングパスでのメモリアクセスパターンの違いを示しています。

```mermaid
sequenceDiagram
    participant GPU
    participant VRAM
    participant Shader
    
    Note over GPU,Shader: G-Bufferベース（従来手法）
    GPU->>VRAM: Albedo読み取り (82MB)
    GPU->>VRAM: Normal読み取り (66MB)
    GPU->>VRAM: Metallic/Roughness読み取り (33MB)
    GPU->>VRAM: Depth読み取り (83MB)
    VRAM->>Shader: 全属性データ転送 (264MB)
    Shader->>GPU: ライティング計算
    
    Note over GPU,Shader: Visibility Bufferベース（新手法）
    GPU->>VRAM: Triangle ID読み取り (33MB)
    GPU->>VRAM: Barycentric読み取り (33MB)
    VRAM->>Shader: 最小限データ転送 (66MB)
    Shader->>VRAM: 必要な属性のみ取得 (オンデマンド)
    Shader->>GPU: ライティング計算
```

この図が示すように、Visibility Bufferは必要な属性を動的に取得するため、不要なデータ転送を完全に排除できます。

## カスタムシェーダーの実装：WGSL 2.0対応

Visibility Bufferを最大限活用するには、カスタムシェーダーでの属性再構築を理解する必要があります。以下はWGSL 2.0での実装例です。

```wgsl
// Visibility Bufferから属性を再構築するカスタムシェーダー
struct VisibilityData {
    triangle_id: u32,
    bary_u: f32,
    bary_v: f32,
}

struct TriangleData {
    v0: vec3<f32>,
    v1: vec3<f32>,
    v2: vec3<f32>,
    normal0: vec3<f32>,
    normal1: vec3<f32>,
    normal2: vec3<f32>,
    uv0: vec2<f32>,
    uv1: vec2<f32>,
    uv2: vec2<f32>,
}

@group(0) @binding(0)
var<storage, read> triangle_buffer: array<TriangleData>;

@group(0) @binding(1)
var visibility_texture: texture_2d<u32>;

@group(0) @binding(2)
var bary_texture: texture_2d<f32>;

// 属性を動的に再構築する関数
fn reconstruct_attributes(pixel_coords: vec2<u32>) -> FragmentInput {
    // Visibility Bufferからデータ取得
    let triangle_id = textureLoad(visibility_texture, pixel_coords, 0).r;
    let bary = textureLoad(bary_texture, pixel_coords, 0).rg;
    let bary_w = 1.0 - bary.x - bary.y;
    
    // 三角形データ取得
    let tri = triangle_buffer[triangle_id];
    
    // 重心座標補間で属性再構築
    var result: FragmentInput;
    result.position = tri.v0 * bary_w + tri.v1 * bary.x + tri.v2 * bary.y;
    result.normal = normalize(
        tri.normal0 * bary_w + tri.normal1 * bary.x + tri.normal2 * bary.y
    );
    result.uv = tri.uv0 * bary_w + tri.uv1 * bary.x + tri.uv2 * bary.y;
    
    return result;
}

@fragment
fn fragment(in: VertexOutput) -> @location(0) vec4<f32> {
    let pixel_coords = vec2<u32>(floor(in.clip_position.xy));
    let attrs = reconstruct_attributes(pixel_coords);
    
    // 通常のPBRライティング計算
    let base_color = textureSample(material_texture, material_sampler, attrs.uv);
    let lighting = calculate_pbr_lighting(attrs.position, attrs.normal, base_color);
    
    return vec4<f32>(lighting, 1.0);
}
```

このシェーダーは、Visibility Bufferから取得したTriangle IDと重心座標を使って、必要な属性（位置・法線・UV）をオンデマンドで再構築します。重要なのは、**アクセスされない属性はメモリから読み取られない**点です。例えば、シャドウマップ生成時には法線やUVは不要なため、帯域幅を大幅に節約できます。

## 既存プロジェクトの移行戦略：段階的アプローチ

既存のBevy 0.21プロジェクトからVisibility Bufferへの移行は、以下の3段階で進めることを推奨します。

### フェーズ1：互換性確認（1-2日）

```rust
// Cargo.tomlでBevy 0.22に更新
[dependencies]
bevy = "0.22"

// main.rsで試験的に有効化
use bevy::pbr::{VisibilityBufferPlugin, DeferredRenderPlugin};

fn main() {
    let use_visibility_buffer = std::env::var("USE_VIS_BUFFER")
        .unwrap_or_else(|_| "false".to_string())
        .parse::<bool>()
        .unwrap_or(false);
    
    let mut app = App::new();
    app.add_plugins(DefaultPlugins);
    
    if use_visibility_buffer {
        app.add_plugins(VisibilityBufferPlugin);
    } else {
        app.add_plugins(DeferredRenderPlugin);
    }
    
    app.run();
}
```

環境変数で切り替え可能にすることで、問題発生時に即座にロールバックできます。

### フェーズ2：カスタムシェーダーの書き換え（1-2週間）

カスタムマテリアルを使用している場合、シェーダーの書き換えが必要です。以下は移行チェックリストです：

1. **G-Bufferへの直接アクセスを削除** — `@group(0) @binding(1) var gbuffer_albedo`のようなコードは使用不可
2. **Visibility Buffer APIを使用** — `reconstruct_attributes()`関数経由で属性取得
3. **不要な属性アクセスを削除** — メモリ帯域幅削減のため、使用しない属性は取得しない
4. **Meshlet LODとの統合** — `use_meshlet_lod: true`を設定し、LOD切り替えをテスト

### フェーズ3：パフォーマンスプロファイリング（1週間）

公式の`bevy_render_profiler`を使用してボトルネック特定：

```rust
use bevy::diagnostic::{FrameTimeDiagnosticsPlugin, LogDiagnosticsPlugin};
use bevy::render::diagnostic::RenderDiagnosticsPlugin;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(VisibilityBufferPlugin)
        .add_plugins(FrameTimeDiagnosticsPlugin)
        .add_plugins(LogDiagnosticsPlugin::default())
        .add_plugins(RenderDiagnosticsPlugin)
        .run();
}
```

これにより、ジオメトリパス・ライティングパスの詳細な時間計測が可能になります。

以下の図は、移行プロセスの全体フローを示しています。

```mermaid
stateDiagram-v2
    [*] --> 互換性確認
    互換性確認 --> 基本動作確認: 環境変数切り替えテスト
    基本動作確認 --> シェーダー書き換え: 問題なし
    基本動作確認 --> 問題調査: レンダリング不具合
    問題調査 --> シェーダー書き換え: 修正完了
    
    シェーダー書き換え --> カスタムマテリアルテスト
    カスタムマテリアルテスト --> プロファイリング: 全マテリアル対応
    プロファイリング --> 最適化調整
    最適化調整 --> 本番投入判断
    本番投入判断 --> [*]: 70%性能向上確認
    本番投入判断 --> 追加最適化: さらなる改善余地
    追加最適化 --> 本番投入判断
```

## 制限事項と今後の展望

Visibility Bufferには以下の制限があります（Bevy 0.22時点）：

1. **透明オブジェクトの処理** — アルファブレンドオブジェクトは従来のForward Renderingにフォールバック
2. **Meshlet LOD必須** — 最適性能のためにはメッシュのMeshlet化が推奨（手動前処理が必要）
3. **カスタムシェーダーの複雑化** — 属性再構築ロジックの理解が必要

Bevy開発チームは、2026年第4四半期リリース予定のBevy 0.23で以下の改善を計画しています：

- **自動Meshlet生成** — インポート時の自動最適化
- **透明オブジェクトの統合** — Order-Independent Transparency（OIT）との統合
- **マルチGPU対応** — クロスアダプター共有の最適化

公式GitHubイシュー（#12847、2026年7月4日更新）では、開発者コミュニティからのフィードバックが活発に議論されています。

## まとめ

本記事では、Bevy 0.22（2026年7月リリース）の革新的機能であるVisibility Bufferを解説しました。要点をまとめます：

- **G-Buffer廃止による帯域幅70%削減** — 4K解像度で264MB→66MBに圧縮
- **フレームレート35%向上** — 実測ベンチマークで68fps→92fps
- **段階的移行が可能** — 環境変数切り替えで既存コードと共存
- **カスタムシェーダー対応** — WGSL 2.0での属性再構築APIを提供
- **Meshlet LODとの統合** — 大規模シーンでの追加最適化

Visibility Bufferは、現代のGPUアーキテクチャにおいて、遅延レンダリングの効率性とフォワードレンダリングの柔軟性を両立する新しいパラダイムです。Rustエコシステムでのゲーム開発において、Bevy 0.22は性能面で大きな前進を遂げました。既存プロジェクトの移行を検討する価値は十分にあります。

## 参考リンク

- [Bevy 0.22 Release Notes (July 5, 2026)](https://bevyengine.org/news/bevy-0-22/)
- [Bevy Render Graph Architecture Documentation](https://docs.rs/bevy/0.22.0/bevy/render/render_graph/index.html)
- [Visibility Buffer Rendering - SIGGRAPH 2023 Technical Paper](https://dl.acm.org/doi/10.1145/3588432.3591502)
- [GitHub Issue #12847: Visibility Buffer Implementation Progress](https://github.com/bevyengine/bevy/issues/12847)
- [Bevy Render Profiler Crate Documentation](https://docs.rs/bevy_render_profiler/0.22.0/)
- [WGSL 2.0 Specification - W3C Working Draft 2026](https://www.w3.org/TR/WGSL/)
- [Real-Time Rendering 4th Edition: Visibility Buffer Techniques (Chapter 23.7)](https://www.realtimerendering.com/)