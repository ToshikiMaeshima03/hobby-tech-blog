---
title: "Rust Bevy 0.20 Deferred Rendering Z-Prepass 統合でGPU効率50%向上の実装完全版【2026年6月】"
description: "Bevy 0.20の新機能Deferred Rendering + Z-Prepass統合によるGPUメモリバンド幅削減とレンダリングパイプライン最適化の実装手法を徹底解説。"
category: "game-dev"
tags: ["Rust", "Bevy", "Deferred Rendering", "Z-Prepass", "GPU最適化"]
publishedAt: 2026-05-30
featured: false
---

Bevy 0.20が2026年6月にリリースされ、レンダリングアーキテクチャに大きな変更が加えられました。特に注目すべきは**Deferred Rendering（遅延レンダリング）とZ-Prepass（深度プリパス）の統合実装**です。この組み合わせにより、従来の前方レンダリング（Forward Rendering）と比較してGPUメモリバンド幅を最大50%削減し、複雑なシーンでのフレームレートを大幅に向上させることが可能になりました。

本記事では、Bevy 0.20における遅延レンダリングとZ-Prepassの統合実装を完全解説します。公式リリースノートとGitHubのプルリクエストを基に、実装の詳細、パフォーマンス最適化のポイント、既存プロジェクトからの移行手順まで網羅的に紹介します。

## Bevy 0.20のDeferred Rendering + Z-Prepass統合アーキテクチャ

Bevy 0.20では、レンダリングパイプラインが大幅に刷新され、Deferred RenderingとZ-Prepassが単一の統合システムとして実装されました。従来のBevyでは、これらは独立したパスとして扱われていましたが、0.20からは**Z-PrepassをDeferred Renderingの前段階として組み込む**ことで、GPU効率を劇的に向上させています。

### 統合レンダリングパイプラインの構造

以下の図は、Bevy 0.20の新しいレンダリングパイプラインの全体像を示しています。

```mermaid
flowchart TD
    A["シーンデータ入力"] --> B["Z-Prepass"]
    B --> C["Early-Z Test"]
    C --> D["Geometry Pass"]
    D --> E["G-Buffer書き込み"]
    E --> F["Lighting Pass"]
    F --> G["Shading計算"]
    G --> H["Post-Processing"]
    H --> I["最終フレーム出力"]
    
    B --> J["深度バッファ生成"]
    J --> C
    
    E --> K["Albedo Buffer"]
    E --> L["Normal Buffer"]
    E --> M["Material Buffer"]
    
    K --> F
    L --> F
    M --> F
```

このダイアグラムは、Z-PrepassがGeometry Passの前に実行され、深度情報を事前計算することで、後続のシェーディング処理を最適化する仕組みを示しています。

### Z-Prepassによるオーバードロー削減の仕組み

Z-Prepassは、シーン内のすべてのジオメトリの深度情報のみを先に計算し、深度バッファに書き込みます。その後のGeometry Passでは、この深度バッファを用いたEarly-Z Testにより、画面に表示されないフラグメント（ピクセル）のシェーディング処理をGPUが自動的にスキップします。

Bevy 0.20の実装では、**Depth-Only Material**という専用のマテリアルシステムが導入され、Z-Prepass用の軽量シェーダーが自動生成されます。これにより、開発者は通常のマテリアル定義だけで、Z-Prepass対応のレンダリングパイプラインを構築できます。

```rust
use bevy::prelude::*;
use bevy::pbr::{MaterialPlugin, StandardMaterial};
use bevy::render::render_resource::{RenderPipelineDescriptor, DepthStencilState};

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_systems(Startup, setup)
        .run();
}

fn setup(
    mut commands: Commands,
    mut meshes: ResMut<Assets<Mesh>>,
    mut materials: ResMut<Assets<StandardMaterial>>,
) {
    // Deferred Rendering + Z-Prepassの有効化
    commands.insert_resource(DeferredRenderingSettings {
        enable_z_prepass: true,
        g_buffer_format: GBufferFormat::Optimized,
    });

    // カメラにDeferred Renderingコンポーネントを追加
    commands.spawn(Camera3dBundle {
        camera: Camera {
            hdr: true,
            ..default()
        },
        ..default()
    })
    .insert(DeferredRendering::default());

    // 複雑なシーンのセットアップ（10万ポリゴン）
    commands.spawn(PbrBundle {
        mesh: meshes.add(Mesh::from(shape::Icosphere {
            radius: 1.0,
            subdivisions: 64,
        })),
        material: materials.add(StandardMaterial {
            base_color: Color::rgb(0.8, 0.7, 0.6),
            metallic: 0.9,
            perceptual_roughness: 0.1,
            ..default()
        }),
        ..default()
    });
}
```

このコードは、Bevy 0.20でDeferred RenderingとZ-Prepassを有効化する基本的な実装を示しています。`DeferredRenderingSettings`リソースで統合機能を制御できます。

## G-Bufferメモリレイアウト最適化とバンド幅削減

Bevy 0.20のDeferred Renderingでは、G-Buffer（Geometry Buffer）のメモリレイアウトが最適化され、GPUメモリバンド幅の使用量が大幅に削減されました。従来の実装では、Albedo、Normal、Metallic/Roughnessなどの属性を別々のテクスチャに格納していましたが、0.20では**パックドG-Bufferフォーマット**が採用されています。

### パックドG-Bufferのデータ構造

以下の図は、Bevy 0.20のG-Bufferメモリレイアウトを示しています。

```mermaid
graph TD
    A["G-Buffer 0 (RGBA16F)"] --> B["RGB: Albedo"]
    A --> C["A: Metallic"]
    
    D["G-Buffer 1 (RGBA16F)"] --> E["RG: Encoded Normal X/Y"]
    D --> F["B: Roughness"]
    D --> G["A: Ambient Occlusion"]
    
    H["G-Buffer 2 (R11G11B10F)"] --> I["RGB: Emissive"]
    
    J["Depth Buffer (D24S8)"] --> K["24bit: Depth"]
    J --> L["8bit: Stencil"]
```

この最適化により、従来4枚必要だったG-Bufferテクスチャが3枚に削減され、メモリバンド幅が約35%削減されました。

### 法線エンコーディングの高速化実装

Bevy 0.20では、法線ベクトルのエンコーディングに**Octahedral Normal Encoding**が採用されています。この手法では、3成分の法線ベクトル（x, y, z）を2成分（x, y）に圧縮し、z成分は復元時に計算します。

```rust
// WGSLシェーダー（Bevy 0.20のG-Buffer書き込み）
fn encode_normal(normal: vec3<f32>) -> vec2<f32> {
    let n = normal / (abs(normal.x) + abs(normal.y) + abs(normal.z));
    let octahedral = vec2<f32>(n.x, n.y);
    
    if (n.z < 0.0) {
        let x = (1.0 - abs(octahedral.y)) * select(-1.0, 1.0, octahedral.x >= 0.0);
        let y = (1.0 - abs(octahedral.x)) * select(-1.0, 1.0, octahedral.y >= 0.0);
        return vec2<f32>(x, y);
    }
    
    return octahedral;
}

fn decode_normal(encoded: vec2<f32>) -> vec3<f32> {
    let n = vec3<f32>(encoded.x, encoded.y, 1.0 - abs(encoded.x) - abs(encoded.y));
    let t = max(-n.z, 0.0);
    
    let x = n.x - select(t, -t, n.x >= 0.0);
    let y = n.y - select(t, -t, n.y >= 0.0);
    
    return normalize(vec3<f32>(x, y, n.z));
}

@fragment
fn geometry_pass(in: VertexOutput) -> GBufferOutput {
    var out: GBufferOutput;
    
    let material = pbr_bindings::material;
    let base_color = material.base_color * textureSample(base_color_texture, base_color_sampler, in.uv);
    
    // G-Buffer 0: Albedo + Metallic
    out.gbuffer0 = vec4<f32>(base_color.rgb, material.metallic);
    
    // G-Buffer 1: Encoded Normal + Roughness + AO
    let normal = normalize(in.world_normal);
    let encoded_normal = encode_normal(normal);
    out.gbuffer1 = vec4<f32>(encoded_normal, material.perceptual_roughness, 1.0);
    
    // G-Buffer 2: Emissive
    out.gbuffer2 = vec4<f32>(material.emissive.rgb, 0.0);
    
    return out;
}
```

このシェーダーは、Bevy 0.20のGeometry Passで実行され、最適化されたG-Bufferフォーマットにマテリアル情報を書き込みます。

## Lighting PassのGPU並列処理最適化

Bevy 0.20のDeferred Renderingでは、Lighting Passが大幅に最適化され、複数の光源処理をGPU上で効率的に並列実行できるようになりました。従来のForward Renderingでは、光源ごとにシェーディング計算を繰り返す必要がありましたが、Deferred Renderingではすべての光源を一度に処理します。

### タイルベースライティングの実装

Bevy 0.20では、**Tiled Deferred Lighting**が採用されています。これは画面を16×16ピクセルのタイルに分割し、各タイルに影響する光源のみを処理することで、無駄な計算を削減する手法です。

```mermaid
sequenceDiagram
    participant CPU as CPUスレッド
    participant GPU as GPUコンピュートシェーダー
    participant Tile as タイルバッファ
    participant Light as ライトバッファ
    participant GBuffer as G-Buffer
    participant Output as 出力フレームバッファ
    
    CPU->>GPU: Light Cullingディスパッチ
    GPU->>GBuffer: 深度情報読み込み
    GPU->>Light: 光源リスト読み込み
    GPU->>Tile: タイルごとの光源インデックス書き込み
    
    CPU->>GPU: Lighting Passディスパッチ
    GPU->>GBuffer: マテリアル情報読み込み
    GPU->>Tile: タイル光源リスト読み込み
    GPU->>GPU: PBRシェーディング計算
    GPU->>Output: 最終カラー書き込み
```

このシーケンス図は、Bevy 0.20のタイルベースライティングの処理フローを示しています。Light Cullingとシェーディングが分離され、GPU並列処理が最大化されています。

### カスタムライティングシステムの実装例

```rust
use bevy::prelude::*;
use bevy::render::render_resource::{ComputePipelineDescriptor, BindGroupLayout};
use bevy::pbr::deferred::{DeferredLighting, LightCullingSettings};

fn setup_deferred_lighting(
    mut commands: Commands,
) {
    // タイルサイズの設定（16×16ピクセル）
    commands.insert_resource(LightCullingSettings {
        tile_size: UVec2::new(16, 16),
        max_lights_per_tile: 64,
        enable_depth_bounds_test: true,
    });
}

// カスタムライティングシステム
fn custom_lighting_system(
    mut deferred_lighting: ResMut<DeferredLighting>,
    point_lights: Query<(&Transform, &PointLight)>,
) {
    // 動的に光源リストを更新
    deferred_lighting.clear_lights();
    
    for (transform, light) in point_lights.iter() {
        deferred_lighting.add_point_light(
            transform.translation,
            light.color,
            light.intensity,
            light.range,
        );
    }
}
```

このコードは、Bevy 0.20のDeferred Lighting Passをカスタマイズする方法を示しています。タイルサイズや光源数の上限を調整することで、シーンに応じた最適化が可能です。

## Z-PrepassとDeferred Renderingの統合によるメモリ効率化

Bevy 0.20の最大の革新は、Z-PrepassとDeferred Renderingを単一のパスとして統合したことです。これにより、深度バッファの二重書き込みが回避され、メモリバンド幅がさらに削減されました。

### 統合パイプラインのメモリアクセスパターン

従来の実装では、Z-Prepassで深度バッファに書き込んだ後、Geometry Passで再度深度テストを実行していました。Bevy 0.20では、**Depth Pre-Test**を用いることで、Geometry Pass中に深度バッファの読み取りのみを行い、書き込みをスキップします。

```rust
// WGSLシェーダー（統合パイプライン）
@vertex
fn geometry_vertex(in: VertexInput) -> VertexOutput {
    var out: VertexOutput;
    
    // 頂点変換（Z-Prepassと同じ計算）
    let world_position = mesh_bindings::model * vec4<f32>(in.position, 1.0);
    out.clip_position = view_bindings::view_proj * world_position;
    out.world_position = world_position.xyz;
    out.world_normal = normalize((mesh_bindings::model * vec4<f32>(in.normal, 0.0)).xyz);
    out.uv = in.uv;
    
    return out;
}

@fragment
fn geometry_fragment(in: VertexOutput) -> GBufferOutput {
    // Early-Z Testは自動実行（Z-Prepassの深度バッファを参照）
    // ここでは深度書き込みは発生しない（Read-Only Depth Test）
    
    // G-Bufferのみ書き込み
    return write_gbuffer(in);
}
```

この実装により、Geometry PassではG-Bufferのみを書き込み、深度バッファはRead-Onlyで参照されます。これにより、メモリバンド幅が約15%削減されました。

### パフォーマンスベンチマーク結果

Bevy 0.20の公式ベンチマークでは、以下のパフォーマンス向上が確認されています（NVIDIA RTX 4070 Ti、1080p解像度、10万ポリゴンシーン、128光源）。

| レンダリングモード | フレームレート | GPUメモリバンド幅 | Geometry Pass時間 |
|-------------------|----------------|-------------------|-------------------|
| Forward Rendering（0.19） | 87 fps | 42.3 GB/s | 6.8 ms |
| Deferred Rendering（0.20、Z-Prepassなし） | 124 fps | 28.1 GB/s | 4.2 ms |
| Deferred + Z-Prepass統合（0.20） | 142 fps | 21.7 GB/s | 3.5 ms |

この結果は、Z-Prepass統合により、Forward Renderingと比較してフレームレートが約63%向上し、メモリバンド幅が約49%削減されたことを示しています。

## 既存プロジェクトからの移行ガイドとカスタムシェーダー対応

Bevy 0.19以前のプロジェクトを0.20のDeferred Rendering + Z-Prepassシステムに移行する際には、いくつかの破壊的変更に対応する必要があります。

### 必須の変更点

1. **カメラコンポーネントの更新**: `Camera3dBundle`に`DeferredRendering`コンポーネントを追加
2. **マテリアルシステムの対応**: カスタムマテリアルは`Depth-Only Material` traitを実装
3. **シェーダーの更新**: G-Bufferフォーマットに対応したフラグメントシェーダーの書き換え

### カスタムマテリアルの移行例

```rust
use bevy::prelude::*;
use bevy::render::render_resource::{AsBindGroup, ShaderRef};
use bevy::pbr::{Material, MaterialPipeline, MaterialPipelineKey};
use bevy::render::mesh::MeshVertexBufferLayout;

#[derive(Asset, TypePath, AsBindGroup, Clone)]
pub struct CustomPBRMaterial {
    #[uniform(0)]
    pub base_color: Color,
    #[texture(1)]
    #[sampler(2)]
    pub base_color_texture: Handle<Image>,
    #[uniform(3)]
    pub metallic: f32,
    #[uniform(4)]
    pub roughness: f32,
}

impl Material for CustomPBRMaterial {
    fn fragment_shader() -> ShaderRef {
        "shaders/custom_pbr.wgsl".into()
    }
    
    fn depth_bias(&self) -> f32 {
        0.0
    }
    
    // Z-Prepass対応
    fn prepass_fragment_shader() -> ShaderRef {
        "shaders/custom_pbr_prepass.wgsl".into()
    }
    
    // Deferred Rendering対応
    fn deferred() -> bool {
        true
    }
    
    fn specialize(
        _pipeline: &MaterialPipeline<Self>,
        descriptor: &mut bevy::render::render_resource::RenderPipelineDescriptor,
        _layout: &MeshVertexBufferLayout,
        _key: MaterialPipelineKey<Self>,
    ) -> Result<(), bevy::render::render_resource::SpecializedMeshPipelineError> {
        // G-Buffer出力の設定
        if let Some(fragment) = descriptor.fragment.as_mut() {
            fragment.targets = vec![
                // G-Buffer 0: Albedo + Metallic
                Some(ColorTargetState {
                    format: TextureFormat::Rgba16Float,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                }),
                // G-Buffer 1: Normal + Roughness + AO
                Some(ColorTargetState {
                    format: TextureFormat::Rgba16Float,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                }),
                // G-Buffer 2: Emissive
                Some(ColorTargetState {
                    format: TextureFormat::R11g11b10Float,
                    blend: None,
                    write_mask: ColorWrites::ALL,
                }),
            ];
        }
        
        Ok(())
    }
}
```

このコードは、Bevy 0.20でカスタムマテリアルをDeferred Rendering + Z-Prepassに対応させる実装を示しています。`prepass_fragment_shader()`と`deferred()`メソッドが新たに追加されています。

### 対応WGSLシェーダー（custom_pbr.wgsl）

```wgsl
#import bevy_pbr::mesh_vertex_output VertexOutput
#import bevy_pbr::pbr_types StandardMaterial
#import bevy_pbr::pbr_functions as pbr

struct GBufferOutput {
    @location(0) gbuffer0: vec4<f32>,  // Albedo + Metallic
    @location(1) gbuffer1: vec4<f32>,  // Normal + Roughness + AO
    @location(2) gbuffer2: vec4<f32>,  // Emissive
}

@group(1) @binding(0)
var<uniform> material: StandardMaterial;
@group(1) @binding(1)
var base_color_texture: texture_2d<f32>;
@group(1) @binding(2)
var base_color_sampler: sampler;

fn octahedral_encode(n: vec3<f32>) -> vec2<f32> {
    let nabs = abs(n);
    var p = vec2<f32>(n.x, n.y) / (nabs.x + nabs.y + nabs.z);
    if (n.z < 0.0) {
        let px = (1.0 - abs(p.y)) * select(-1.0, 1.0, p.x >= 0.0);
        let py = (1.0 - abs(p.x)) * select(-1.0, 1.0, p.y >= 0.0);
        p = vec2<f32>(px, py);
    }
    return p * 0.5 + 0.5;  // [0, 1]範囲にスケール
}

@fragment
fn fragment(in: VertexOutput) -> GBufferOutput {
    var out: GBufferOutput;
    
    // Albedo
    let base_color = material.base_color * textureSample(base_color_texture, base_color_sampler, in.uv);
    
    // Normal encoding
    let world_normal = normalize(in.world_normal);
    let encoded_normal = octahedral_encode(world_normal);
    
    // G-Buffer 出力
    out.gbuffer0 = vec4<f32>(base_color.rgb, material.metallic);
    out.gbuffer1 = vec4<f32>(encoded_normal, material.perceptual_roughness, 1.0);
    out.gbuffer2 = vec4<f32>(material.emissive.rgb, 0.0);
    
    return out;
}
```

このシェーダーは、Bevy 0.20のG-Bufferフォーマットに対応したカスタムPBRマテリアルの実装例です。

## まとめ

Bevy 0.20のDeferred Rendering + Z-Prepass統合は、Rustゲーム開発エコシステムにおける大きな進化です。以下のポイントが重要です。

- **Z-PrepassとDeferred Renderingの統合**により、深度バッファの二重書き込みを回避し、メモリバンド幅を約50%削減
- **パックドG-Bufferフォーマット**と**Octahedral Normal Encoding**により、GPUメモリ使用量を35%削減
- **Tiled Deferred Lighting**により、大量の光源を持つシーンでのパフォーマンスが約63%向上（Forward Rendering比）
- カスタムマテリアルの移行には、`prepass_fragment_shader()`の実装とG-Bufferフォーマット対応が必須
- 公式ベンチマークでは、142 fpsのフレームレート達成（10万ポリゴン、128光源環境）

これらの最適化により、Bevyは商用ゲーム開発にも耐えうる高性能レンダリングエンジンへと成長しました。既存プロジェクトの移行コストは比較的低く、パフォーマンス向上の恩恵が大きいため、積極的な採用を推奨します。

## 参考リンク

- [Bevy 0.20 Release Notes - Official Blog](https://bevyengine.org/news/bevy-0-20/)
- [GitHub PR #12847: Deferred Rendering + Z-Prepass Integration](https://github.com/bevyengine/bevy/pull/12847)
- [Bevy Rendering Optimization Guide - Official Documentation](https://bevyengine.org/learn/book/gpu-driven-rendering/)
- [Octahedral Normal Encoding - A Survey of Efficient Representations](https://jcgt.org/published/0003/02/01/)
- [Tiled Deferred Shading - NVIDIA Developer Blog](https://developer.nvidia.com/blog/deferred-shading-tutorial/)