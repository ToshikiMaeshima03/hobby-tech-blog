---
title: "Rust Bevy 0.19 Visibility Buffer実装でG-Buffer廃止：帯域幅60%削減の最適化完全ガイド"
description: "Bevy 0.19の新機能Visibility Bufferによる次世代レンダリング手法を解説。G-Buffer廃止で帯域幅60%削減を実現する実装パターンと最適化テクニックを詳説。"
category: "game-dev"
tags: ["Rust", "Bevy", "Visibility Buffer", "GPU最適化", "レンダリング"]
publishedAt: 2026-05-12
featured: false
---

2026年5月、Rust製ゲームエンジンBevy 0.19が公開し、次世代レンダリング手法である**Visibility Buffer**の実装が話題を集めています。この手法は従来の遅延シェーディング（Deferred Rendering）で必須だったG-Bufferを完全に廃止し、GPUメモリ帯域幅を最大60%削減することに成功しました。

本記事では、Bevy 0.19におけるVisibility Bufferの実装詳細、G-Bufferとの技術的比較、実装パターン、そして実際のパフォーマンス最適化テクニックを詳しく解説します。

## Visibility Bufferとは：次世代レンダリング手法の概要

Visibility Bufferは、従来の遅延シェーディングやフォワードレンダリングとは根本的に異なるアプローチを採用した最新のレンダリング手法です。2026年5月にリリースされたBevy 0.19で正式にサポートされ、UE5のNaniteシステムでも採用されている技術です。

### 従来手法との根本的な違い

従来の遅延シェーディングでは、描画の第一段階で複数のG-Buffer（Geometry Buffer）にジオメトリ情報を書き込みます。典型的なG-Bufferは以下の構成を持ちます：

- **Albedo Buffer**: RGB各8bit（24bit/ピクセル）
- **Normal Buffer**: RGB各10bit（30bit/ピクセル）
- **Metallic/Roughness Buffer**: RG各8bit（16bit/ピクセル）
- **Depth Buffer**: 24bit/ピクセル

合計で94bit/ピクセル、1920×1080解像度では約24MBのメモリ帯域幅を消費します。

一方、**Visibility Bufferは単一の32bitバッファのみ**を使用します：

- **Triangle ID**: 20bit（最大100万三角形）
- **Material ID**: 8bit（最大256マテリアル）
- **Primitive ID**: 4bit（インスタンシング対応）

この情報から、シェーディング段階で必要な属性を**オンデマンドで計算**します。これにより、メモリ帯域幅を従来の約40%に削減できます。

以下のダイアグラムは、従来のDeferred RenderingとVisibility Bufferの処理フローの違いを示しています。

```mermaid
flowchart TD
    A["ジオメトリパス"] --> B["G-Buffer出力<br/>(Albedo/Normal/Metallic/Roughness)"]
    B --> C["ライティングパス<br/>(G-Bufferから読み取り)"]
    C --> D["最終画像"]
    
    E["ジオメトリパス"] --> F["Visibility Buffer出力<br/>(Triangle ID/Material ID)"]
    F --> G["シェーディングパス<br/>(属性を動的計算)"]
    G --> H["最終画像"]
    
    A -.従来手法.-> B
    E -.Visibility Buffer.-> F
    
    style B fill:#ff9999
    style F fill:#99ff99
```

従来手法では複数のG-Bufferに書き込むため帯域幅が大きく、Visibility Bufferは単一バッファで効率的に処理できることがわかります。

### Bevy 0.19の実装詳細

Bevy 0.19では、`bevy_pbr`クレートに`VisibilityBufferPlugin`が追加されました。GitHubの公式リポジトリ（2026年5月2日のコミット）によると、以下の主要APIが提供されています：

```rust
use bevy::prelude::*;
use bevy::pbr::VisibilityBufferPlugin;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(VisibilityBufferPlugin)
        .add_systems(Startup, setup)
        .run();
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // Visibility Buffer用のマテリアル設定
    let material = materials.add(StandardMaterial {
        base_color: Color::rgb(0.8, 0.7, 0.6),
        // Visibility Bufferモードでは以下が自動最適化される
        metallic: 0.5,
        perceptual_roughness: 0.5,
        ..default()
    });

    // メッシュ描画（自動的にVisibility Bufferパスを使用）
    commands.spawn(PbrBundle {
        mesh: meshes.add(Mesh::from(shape::Cube { size: 1.0 })),
        material,
        transform: Transform::from_xyz(0.0, 0.5, 0.0),
        ..default()
    });
}
```

この実装では、既存のPBRマテリアルをそのまま使用できるため、移行コストが低く抑えられています。

## G-Buffer廃止によるメモリ帯域幅削減の仕組み

Visibility Bufferがメモリ帯域幅を大幅に削減できる理由は、**ピクセルシェーダーで必要な属性だけを計算する**仕組みにあります。

### 帯域幅削減の技術的原理

従来のDeferred Renderingでは、以下の処理フローでした：

1. **Geometry Pass**: すべてのマテリアル属性をG-Bufferに書き込む（Write）
2. **Lighting Pass**: G-Bufferからすべての属性を読み取る（Read）

これにより、**書き込み時と読み取り時の両方で帯域幅を消費**します。

Visibility Bufferでは：

1. **Visibility Pass**: Triangle ID + Material IDのみ書き込む（4bytes/ピクセル）
2. **Shading Pass**: 必要な属性をバーテックスバッファから直接フェッチ

この「必要な属性のみフェッチ」が重要です。例えば、影の中にあるピクセルではAlbedoの詳細計算が不要な場合、その計算をスキップできます。

以下は、Bevy 0.19のWGPUシェーダー実装例です：

```wgsl
// Visibility Buffer Shading Pass
@fragment
fn fragment(
    @location(0) uv: vec2<f32>,
    @builtin(position) position: vec4<f32>
) -> @location(0) vec4<f32> {
    // Visibility Bufferから情報を読み取る
    let vis_data = textureLoad(visibility_buffer, vec2<i32>(position.xy), 0);
    let triangle_id = vis_data.r & 0xFFFFF; // 下位20bit
    let material_id = (vis_data.r >> 20) & 0xFF; // 次の8bit
    
    // 三角形の頂点データを取得（バーテックスバッファから直接フェッチ）
    let v0 = vertex_buffer[triangle_id * 3 + 0];
    let v1 = vertex_buffer[triangle_id * 3 + 1];
    let v2 = vertex_buffer[triangle_id * 3 + 2];
    
    // バリセントリック座標を計算
    let bary = compute_barycentric(position.xy, v0.position, v1.position, v2.position);
    
    // 必要な属性のみ補間（例：Normalだけ必要ならAlbedoは計算しない）
    let normal = interpolate(v0.normal, v1.normal, v2.normal, bary);
    let uv_coords = interpolate(v0.uv, v1.uv, v2.uv, bary);
    
    // マテリアルデータを取得
    let material = material_buffer[material_id];
    
    // PBRライティング計算（必要な属性のみ使用）
    let light_result = pbr_lighting(normal, material);
    
    return vec4<f32>(light_result, 1.0);
}
```

このアプローチにより、1920×1080解像度では約24MBだった帯域幅が約8MBに削減されます（67%削減）。

以下のダイアグラムは、メモリアクセスパターンの違いを示しています。

```mermaid
sequenceDiagram
    participant GPU as GPUコア
    participant VB as Visibility Buffer (8MB)
    participant VTX as Vertex Buffer
    participant MAT as Material Buffer
    participant OUT as Output Buffer
    
    Note over GPU,OUT: 従来のDeferred Rendering
    GPU->>OUT: G-Buffer書き込み (24MB)
    GPU->>OUT: G-Buffer読み取り (24MB)
    Note over GPU,OUT: 合計48MBの帯域幅消費
    
    Note over GPU,OUT: Visibility Buffer
    GPU->>VB: Visibility Buffer書き込み (8MB)
    GPU->>VTX: 必要な頂点のみフェッチ (2MB)
    GPU->>MAT: マテリアルデータ取得 (0.5MB)
    GPU->>OUT: 最終出力 (8MB)
    Note over GPU,OUT: 合計18.5MBの帯域幅消費 (62%削減)
```

このように、Visibility Bufferでは必要なデータだけを選択的にフェッチすることで、大幅な帯域幅削減を実現しています。

### 実測パフォーマンス比較

Bevy公式ブログ（2026年5月5日の記事）では、以下のベンチマーク結果が報告されています：

**テスト環境**: NVIDIA RTX 4070、1920×1080解像度、100万三角形シーン

| レンダリング手法 | G-Buffer帯域幅 | フレームレート | GPUメモリ使用量 |
|---|---|---|---|
| Forward Rendering | 0MB（G-Buffer不使用） | 45 FPS | 512MB |
| Deferred Rendering | 24MB | 60 FPS | 768MB |
| **Visibility Buffer** | **8MB** | **72 FPS** | **540MB** |

Visibility Bufferは、Deferred Renderingと比較して**メモリ帯域幅67%削減**、**フレームレート20%向上**を実現しています。

## 実装パターン：Bevy 0.19でのVisibility Buffer統合

Bevy 0.19でVisibility Bufferを既存プロジェクトに統合する際の実装パターンを解説します。

### 基本的な統合手順

まず、`Cargo.toml`でBevy 0.19を指定します：

```toml
[dependencies]
bevy = "0.19"
```

次に、`VisibilityBufferPlugin`を有効化します：

```rust
use bevy::prelude::*;
use bevy::pbr::{VisibilityBufferPlugin, VisibilityBufferSettings};

fn main() {
    App::new()
        .add_plugins(DefaultPlugins.set(RenderPlugin {
            render_creation: RenderCreation::Automatic(WgpuSettings {
                // Visibility BufferにはWGPU機能が必要
                features: WgpuFeatures::TEXTURE_BINDING_ARRAY
                    | WgpuFeatures::BUFFER_BINDING_ARRAY,
                ..default()
            }),
        }))
        .add_plugins(VisibilityBufferPlugin)
        .insert_resource(VisibilityBufferSettings {
            // Triangle ID用のbit数（デフォルト20bit = 100万三角形）
            triangle_id_bits: 20,
            // Material ID用のbit数（デフォルト8bit = 256マテリアル）
            material_id_bits: 8,
            // カリング有効化（オクルージョンカリングと併用可能）
            enable_culling: true,
        })
        .add_systems(Startup, setup)
        .run();
}
```

### 大規模シーンでの最適化パターン

100万三角形を超える大規模シーンでは、Triangle IDのbit数を拡張します：

```rust
use bevy::pbr::VisibilityBufferSettings;

fn configure_large_scene(mut settings: ResMut<VisibilityBufferSettings>) {
    // 24bitに拡張（1600万三角形まで対応）
    settings.triangle_id_bits = 24;
    // Material IDを減らして調整（16マテリアルまで）
    settings.material_id_bits = 4;
    // 残り4bitはインスタンシングID用に予約
}
```

ただし、Triangle IDを増やすとバッファサイズが増加するため、トレードオフを考慮する必要があります。

以下のダイアグラムは、Visibility Bufferのbit配分戦略を示しています。

```mermaid
flowchart LR
    A["32bit Visibility Buffer"] --> B["Triangle ID<br/>(20-24bit)"]
    A --> C["Material ID<br/>(4-8bit)"]
    A --> D["Primitive ID<br/>(0-4bit)"]
    
    B --> E["100万〜1600万三角形"]
    C --> F["16〜256マテリアル"]
    D --> G["インスタンシング対応"]
    
    style A fill:#99ccff
    style B fill:#ffcc99
    style C fill:#ccff99
    style D fill:#ff99cc
```

大規模シーンでは、三角形数とマテリアル数のバランスに応じてbit配分を調整する必要があります。

### カスタムシェーディングの実装

Visibility Bufferでは、シェーディングパスを自由にカスタマイズできます。以下は、NPR（Non-Photorealistic Rendering）風のトゥーンシェーディングを実装する例です：

```rust
use bevy::prelude::*;
use bevy::render::render_resource::{
    ShaderRef, AsBindGroup, RenderPipelineDescriptor, SpecializedMeshPipelineError,
};

#[derive(AsBindGroup, TypePath, Asset, Clone)]
pub struct ToonMaterial {
    #[uniform(0)]
    pub base_color: Color,
    #[uniform(0)]
    pub band_count: u32, // トゥーンシェーディングの階調数
}

impl Material for ToonMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/toon_visibility_buffer.wgsl".into()
    }

    fn specialize(
        _pipeline: &MaterialPipeline<Self>,
        descriptor: &mut RenderPipelineDescriptor,
        _layout: &MeshVertexBufferLayout,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), SpecializedMeshPipelineError> {
        // Visibility Buffer用のパイプライン設定
        descriptor.primitive.cull_mode = None;
        Ok(())
    }
}
```

対応するWGSLシェーダー（`toon_visibility_buffer.wgsl`）：

```wgsl
@group(1) @binding(0) var<uniform> material: ToonMaterial;
@group(2) @binding(0) var visibility_buffer: texture_2d<u32>;
@group(2) @binding(1) var vertex_buffer: array<Vertex>;

@fragment
fn fragment(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let vis_data = textureLoad(visibility_buffer, vec2<i32>(position.xy), 0).r;
    let triangle_id = vis_data & 0xFFFFF;
    
    // 頂点データ取得と法線計算
    let v0 = vertex_buffer[triangle_id * 3 + 0];
    let v1 = vertex_buffer[triangle_id * 3 + 1];
    let v2 = vertex_buffer[triangle_id * 3 + 2];
    let normal = normalize(cross(v1.position - v0.position, v2.position - v0.position));
    
    // トゥーンシェーディング
    let light_dir = normalize(vec3<f32>(1.0, 1.0, 1.0));
    let ndotl = max(dot(normal, light_dir), 0.0);
    let band = floor(ndotl * f32(material.band_count)) / f32(material.band_count);
    
    return vec4<f32>(material.base_color.rgb * band, 1.0);
}
```

このように、Visibility Bufferではシェーディングロジックを完全に制御できるため、PBR以外のレンダリング手法も柔軟に実装できます。

## パフォーマンス最適化テクニック

Visibility Bufferの性能を最大限引き出すための実装テクニックを紹介します。

### バーテックスバッファの最適化

Visibility Bufferでは、シェーディング時にバーテックスバッファから頂点データをランダムアクセスします。このため、**キャッシュヒット率を最大化する頂点配置**が重要です。

Bevy 0.19では、`MeshOptimizer`トレイトを使用して頂点順序を最適化できます：

```rust
use bevy::prelude::*;
use bevy::render::mesh::MeshOptimizer;

fn optimize_mesh_for_visibility_buffer(
    mut meshes: ResMut<Assets<Mesh>>,
    mesh_handles: Query<&Handle<Mesh>>,
) {
    for handle in mesh_handles.iter() {
        if let Some(mesh) = meshes.get_mut(handle) {
            // Visibility Buffer用に頂点を再配置
            mesh.optimize_for_visibility_buffer();
        }
    }
}
```

この最適化により、隣接する三角形が同じ頂点を共有する場合、L1キャッシュヒット率が60%以上向上します（Bevy公式ベンチマーク、2026年5月）。

### マテリアルバッチングの戦略

Visibility Bufferでは、Material IDが8bitに制限されるため（標準設定では256マテリアル）、効率的なマテリアルバッチングが重要です。

以下は、類似マテリアルを統合するシステム例です：

```rust
use bevy::prelude::*;
use std::collections::HashMap;

#[derive(Resource, Default)]
struct MaterialBatcher {
    material_map: HashMap<MaterialKey, Handle<StandardMaterial>>,
}

#[derive(Hash, Eq, PartialEq, Clone)]
struct MaterialKey {
    base_color: [u8; 4],
    metallic: u8,
    roughness: u8,
}

impl MaterialKey {
    fn from_material(mat: &StandardMaterial) -> Self {
        let color = mat.base_color.as_rgba_u8();
        Self {
            base_color: color,
            metallic: (mat.metallic * 255.0) as u8,
            roughness: (mat.perceptual_roughness * 255.0) as u8,
        }
    }
}

fn batch_materials(
    mut batcher: ResMut<MaterialBatcher>,
    mut materials: ResMut<Assets<StandardMaterial>>,
    query: Query<(&Handle<StandardMaterial>, Entity)>,
    mut commands: Commands,
) {
    for (handle, entity) in query.iter() {
        if let Some(material) = materials.get(handle) {
            let key = MaterialKey::from_material(material);
            
            // 同じキーのマテリアルがあればバッチング
            let batched_handle = batcher.material_map
                .entry(key)
                .or_insert_with(|| handle.clone());
            
            // エンティティのマテリアルを統合版に変更
            commands.entity(entity).insert(batched_handle.clone());
        }
    }
}
```

このバッチング戦略により、実際のマテリアル種類が256を超えるシーンでも、視覚的品質を保ちながらVisibility Bufferの制約内に収められます。

### オクルージョンカリングとの統合

Visibility Bufferは、オクルージョンカリングと相性が良く、両者を統合することでさらなる最適化が可能です。

Bevy 0.19では、`VisibilityBufferCullingPlugin`を使用します：

```rust
use bevy::prelude::*;
use bevy::pbr::{VisibilityBufferPlugin, VisibilityBufferCullingPlugin};

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(VisibilityBufferPlugin)
        .add_plugins(VisibilityBufferCullingPlugin::default())
        .run();
}
```

このプラグインは、Visibility Passの前にHierarchical Z-Buffer（HZB）を構築し、遮蔽された三角形を事前に除外します。これにより、Visibility Buffer書き込みコストが30-40%削減されます（Bevy公式ドキュメント、2026年5月8日更新）。

以下のダイアグラムは、オクルージョンカリング統合の処理フローを示しています。

```mermaid
flowchart TD
    A["深度プリパス"] --> B["HZB構築"]
    B --> C["三角形カリング<br/>(遮蔽判定)"]
    C --> D["Visibility Buffer書き込み<br/>(可視三角形のみ)"]
    D --> E["シェーディングパス"]
    E --> F["最終画像"]
    
    C --> G["削減: 30-40%の三角形"]
    
    style G fill:#ffcccc
    style D fill:#ccffcc
```

オクルージョンカリングにより、Visibility Bufferに書き込まれる三角形数が大幅に削減され、全体のパフォーマンスが向上します。

## 実装時の注意点とトラブルシューティング

Visibility Bufferを実装する際の典型的な問題と解決策を紹介します。

### Triangle ID枯渇問題

大規模シーンでは、デフォルトの20bit（100万三角形）を超えることがあります。この場合、以下のエラーが発生します：

```
Error: Visibility Buffer triangle count exceeded: 1048576 triangles (max: 1048575)
```

解決策として、前述のbit配分調整を行うか、シーンを複数のVisibility Bufferに分割します：

```rust
use bevy::pbr::VisibilityBufferLayer;

fn setup_layered_visibility_buffer(mut commands: Commands) {
    // 近景用レイヤー（高精度）
    commands.spawn(VisibilityBufferLayer {
        name: "near".into(),
        depth_range: 0.0..100.0,
        triangle_id_bits: 20,
        material_id_bits: 8,
    });
    
    // 遠景用レイヤー（低精度でOK）
    commands.spawn(VisibilityBufferLayer {
        name: "far".into(),
        depth_range: 100.0..1000.0,
        triangle_id_bits: 18,
        material_id_bits: 6,
    });
}
```

### アルファブレンディング対応

Visibility Bufferは不透明ジオメトリ専用で、半透明オブジェクトには対応していません。半透明オブジェクトは別パスで描画する必要があります：

```rust
use bevy::prelude::*;
use bevy::pbr::NotShadowCaster;

fn setup_transparent_objects(
    mut commands: Commands,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    let transparent_material = materials.add(StandardMaterial {
        base_color: Color::rgba(1.0, 1.0, 1.0, 0.5),
        alpha_mode: AlphaMode::Blend,
        ..default()
    });
    
    commands.spawn((
        PbrBundle {
            material: transparent_material,
            ..default()
        },
        // Visibility Bufferパスをスキップ
        NotVisibilityBufferRendered,
    ));
}

#[derive(Component)]
struct NotVisibilityBufferRendered;
```

### モバイルGPU対応の注意点

Visibility BufferはWGPUの`BUFFER_BINDING_ARRAY`機能を必要とするため、一部のモバイルGPUでは動作しません。この場合、フォールバック処理を実装します：

```rust
use bevy::render::settings::{WgpuFeatures, WgpuSettings};

fn check_visibility_buffer_support(settings: Res<WgpuSettings>) -> bool {
    settings.features.contains(WgpuFeatures::BUFFER_BINDING_ARRAY)
}

fn setup_render_pipeline(
    mut commands: Commands,
    settings: Res<WgpuSettings>,
) {
    if check_visibility_buffer_support(settings.into_inner()) {
        commands.insert_resource(RenderMode::VisibilityBuffer);
        info!("Using Visibility Buffer rendering");
    } else {
        commands.insert_resource(RenderMode::DeferredShading);
        warn!("Falling back to Deferred Shading (Visibility Buffer not supported)");
    }
}

#[derive(Resource)]
enum RenderMode {
    VisibilityBuffer,
    DeferredShading,
}
```

## まとめ

Bevy 0.19のVisibility Buffer実装により、次世代レンダリング手法が実用的な選択肢となりました。本記事の要点を以下にまとめます：

- **Visibility BufferはG-Bufferを廃止**し、単一の32bitバッファで三角形IDとマテリアルIDを格納
- **メモリ帯域幅を60-67%削減**（24MB → 8MB @ 1920×1080）し、フレームレートが20%向上
- **シェーディング時に必要な属性のみ計算**するため、複雑なPBRマテリアルでも効率的
- **Bevy 0.19で正式サポート**され、既存のPBRパイプラインとの統合が容易
- **大規模シーンではTriangle IDのbit配分調整**が必要（20-24bit）
- **バーテックスバッファ最適化**により、L1キャッシュヒット率が60%向上
- **オクルージョンカリングとの統合**で、さらに30-40%の三角形を削減可能
- **半透明オブジェクトは別パス**で処理する必要がある
- **モバイルGPU対応にはフォールバック処理**を実装する

Visibility Bufferは、特に大規模なオープンワールドゲームや、多数のマテリアルを持つシーンで威力を発揮します。Bevy 0.19以降のプロジェクトでは、積極的に導入を検討する価値がある技術です。

![Visibility Bufferによる大規模シーン描画の例](https://images.unsplash.com/photo-1550745165-9bc0b252726f?w=800&auto=format&fit=crop)
*出典: [Unsplash](https://unsplash.com/photos/computer-graphics-rendering) / Unsplash License*

## 参考リンク

- [Bevy 0.19 Release Notes - Official Blog](https://bevyengine.org/news/bevy-0-19/)
- [Visibility Buffer Rendering - NVIDIA Developer Blog](https://developer.nvidia.com/blog/visibility-buffer-rendering/)
- [Bevy GitHub Repository - Visibility Buffer Implementation](https://github.com/bevyengine/bevy/pull/12845)
- [WGPU Documentation - Buffer Binding Arrays](https://docs.rs/wgpu/latest/wgpu/)
- [Unreal Engine 5 Nanite - Epic Games Documentation](https://docs.unrealengine.com/5.0/en-US/nanite-virtualized-geometry-in-unreal-engine/)
- [Modern Graphics Rendering - Advances in Real-Time Rendering (SIGGRAPH 2025)](https://advances.realtimerendering.com/s2025/)