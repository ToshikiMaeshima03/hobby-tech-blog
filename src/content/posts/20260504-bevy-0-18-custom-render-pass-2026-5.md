---
title: "Bevy 0.18 Custom Render Pass 実装ガイド｜複雑なエフェクトパイプライン構築の完全版【2026年5月】"
description: "Bevy 0.18の新しいレンダリングアーキテクチャでカスタムレンダーパスを実装する方法を解説。ポストエフェクト、アウトライン描画、被写界深度などの高度なエフェクトパイプラインの構築手法を実装例付きで紹介"
category: "game-dev"
tags: ["Rust", "Bevy", "レンダリングパイプライン", "GPU最適化", "WGPU"]
publishedAt: 2026-05-04
featured: false
---

Bevy 0.18（2026年5月リリース）では、レンダリングアーキテクチャが大幅に刷新され、カスタムレンダーパスの実装が従来よりも柔軟かつ効率的になりました。この記事では、Bevy 0.18の新しいRender Graph APIを使った複雑なエフェクトパイプラインの構築方法を、実装例とともに解説します。

## Bevy 0.18 のレンダリングアーキテクチャ刷新内容

Bevy 0.18では、Render Graphの内部構造が完全に再設計されました。従来のバージョンでは`Node`と`Edge`の定義が複雑で、依存関係の管理が煩雑でしたが、0.18では**Declarative Render Graph API**が導入され、宣言的な記述で複雑なパイプラインを構築できるようになっています。

2026年5月1日のBevy公式ブログによると、この変更により以下の改善が実現されました：

- **ノード定義の簡素化**: 従来の`Node` traitの実装が不要になり、関数ベースで定義可能に
- **依存関係の自動解決**: Render Graph内のノード間の依存関係を自動で解決
- **メモリ効率の向上**: 中間バッファの再利用戦略が最適化され、GPUメモリ使用量が平均30%削減

以下のダイアグラムは、Bevy 0.18の新しいRender Graphアーキテクチャを示しています。

```mermaid
graph TD
    A["Main World (ECS)"] --> B["Extract Stage"]
    B --> C["Render World"]
    C --> D["Prepare Stage"]
    D --> E["Queue Stage"]
    E --> F["Render Graph Execution"]
    F --> G["Main Pass Node"]
    F --> H["Custom Pass Node 1"]
    F --> I["Custom Pass Node 2"]
    F --> J["Post-Process Node"]
    G --> K["Intermediate Texture"]
    H --> K
    I --> K
    K --> J
    J --> L["Final Output"]
```

この図は、ECSのメインワールドからレンダーワールドへのデータ抽出、そしてRender Graph内でのカスタムパスの実行フローを示しています。各ノードは並列実行可能で、依存関係のあるノードのみが順次実行されます。

## カスタムレンダーパスの基本実装

Bevy 0.18でカスタムレンダーパスを実装するには、`RenderGraphNode` traitを実装する必要があります。以下は、基本的なアウトライン描画パスの実装例です。

```rust
use bevy::{
    prelude::*,
    render::{
        render_graph::{Node, RenderGraphContext, RenderLabel},
        render_resource::{
            BindGroup, BindGroupLayout, CachedRenderPipelineId,
            LoadOp, Operations, PipelineCache, RenderPassColorAttachment,
            RenderPassDescriptor, StoreOp,
        },
        renderer::RenderContext,
        view::ViewTarget,
    },
};

#[derive(Debug, Hash, PartialEq, Eq, Clone, RenderLabel)]
pub struct OutlinePassLabel;

pub struct OutlinePassNode {
    query: QueryState<&'static ViewTarget>,
}

impl OutlinePassNode {
    pub fn new(world: &mut World) -> Self {
        Self {
            query: world.query(),
        }
    }
}

impl Node for OutlinePassNode {
    fn update(&mut self, world: &mut World) {
        self.query.update_archetypes(world);
    }

    fn run(
        &self,
        graph: &mut RenderGraphContext,
        render_context: &mut RenderContext,
        world: &World,
    ) -> Result<(), NodeRunError> {
        let view_entity = graph.view_entity();
        let Ok(view_target) = self.query.get_manual(world, view_entity) else {
            return Ok(());
        };

        let mut render_pass = render_context.begin_tracked_render_pass(
            RenderPassDescriptor {
                label: Some("outline_pass"),
                color_attachments: &[Some(RenderPassColorAttachment {
                    view: view_target.main_texture(),
                    resolve_target: None,
                    ops: Operations {
                        load: LoadOp::Load,
                        store: StoreOp::Store,
                    },
                })],
                depth_stencil_attachment: None,
                timestamp_writes: None,
                occlusion_query_set: None,
            }
        );

        // カスタムシェーダーでアウトライン描画
        // ここにバインドグループ設定と描画コマンドが入る

        Ok(())
    }
}
```

このコードでは、`ViewTarget`を取得して既存のレンダーターゲットに対してパスを実行しています。`LoadOp::Load`により、前のパスの結果を保持したまま追加の描画を行えます。

## 複雑なエフェクトパイプライン：被写界深度（DoF）の実装

被写界深度エフェクトは、複数のパスを組み合わせた典型的な例です。以下の手順で実装します：

1. **深度バッファの抽出**: メインパスから深度情報を取得
2. **CoC（Circle of Confusion）マップ生成**: 深度に基づいてボケ量を計算
3. **ガウシアンブラー適用**: 水平・垂直の2パスでボケを生成
4. **合成パス**: 元画像とブラー画像をCoCマップに基づいて合成

以下のシーケンス図は、DoFエフェクトの処理フローを示しています。

```mermaid
sequenceDiagram
    participant Main as Main Pass
    participant Depth as Depth Extract
    participant CoC as CoC Generation
    participant Blur as Gaussian Blur
    participant Composite as Composite Pass
    participant Output as Final Output

    Main->>Depth: Depth Buffer
    Main->>CoC: Color Buffer
    Depth->>CoC: Depth Data
    CoC->>Blur: CoC Map
    Main->>Composite: Original Color
    Blur->>Composite: Blurred Color
    CoC->>Composite: CoC Map
    Composite->>Output: Final Frame
```

この図は、各パスがどのようにデータを受け渡しているかを明確に示しています。

以下は、CoCマップ生成パスの実装例です：

```rust
use bevy::render::render_resource::{
    BindGroupLayoutEntry, BindingType, SamplerBindingType,
    ShaderStages, TextureSampleType, TextureViewDimension,
};

#[derive(Resource)]
pub struct CocPipeline {
    layout: BindGroupLayout,
    pipeline_id: CachedRenderPipelineId,
    sampler: Sampler,
}

impl FromWorld for CocPipeline {
    fn from_world(world: &mut World) -> Self {
        let render_device = world.resource::<RenderDevice>();
        
        let layout = render_device.create_bind_group_layout(
            "coc_bind_group_layout",
            &[
                BindGroupLayoutEntry {
                    binding: 0,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Texture {
                        sample_type: TextureSampleType::Depth,
                        view_dimension: TextureViewDimension::D2,
                        multisampled: false,
                    },
                    count: None,
                },
                BindGroupLayoutEntry {
                    binding: 1,
                    visibility: ShaderStages::FRAGMENT,
                    ty: BindingType::Sampler(SamplerBindingType::NonFiltering),
                    count: None,
                },
            ],
        );

        let sampler = render_device.create_sampler(&SamplerDescriptor {
            label: Some("coc_sampler"),
            address_mode_u: AddressMode::ClampToEdge,
            address_mode_v: AddressMode::ClampToEdge,
            mag_filter: FilterMode::Nearest,
            min_filter: FilterMode::Nearest,
            ..default()
        });

        // パイプラインキャッシュからシェーダーをロード
        let pipeline_cache = world.resource::<PipelineCache>();
        let pipeline_id = pipeline_cache.queue_render_pipeline(
            RenderPipelineDescriptor {
                label: Some("coc_pipeline".into()),
                layout: vec![layout.clone()],
                // シェーダー設定は省略
                ..default()
            }
        );

        Self {
            layout,
            pipeline_id,
            sampler,
        }
    }
}
```

CoCマップを生成するシェーダー（WGSL）は以下のようになります：

```wgsl
@group(0) @binding(0) var depth_texture: texture_depth_2d;
@group(0) @binding(1) var depth_sampler: sampler;

struct CameraParams {
    focus_distance: f32,
    focal_length: f32,
    aperture: f32,
}

@group(1) @binding(0) var<uniform> camera: CameraParams;

@fragment
fn fragment(@location(0) uv: vec2<f32>) -> @location(0) f32 {
    let depth = textureSample(depth_texture, depth_sampler, uv);
    let linear_depth = linearize_depth(depth);
    
    // CoC計算（物理ベースのボケ量）
    let coc = abs(camera.aperture * (camera.focal_length * 
        (linear_depth - camera.focus_distance)) / 
        (linear_depth * (camera.focus_distance - camera.focal_length)));
    
    return clamp(coc, 0.0, 1.0);
}

fn linearize_depth(depth: f32) -> f32 {
    let z_near = 0.1;
    let z_far = 1000.0;
    return (2.0 * z_near) / (z_far + z_near - depth * (z_far - z_near));
}
```

このシェーダーでは、物理ベースのレンズ方程式を使用してボケ量を計算しています。`aperture`（絞り値）、`focal_length`（焦点距離）、`focus_distance`（フォーカス距離）をパラメータとして受け取ります。

## 中間バッファの効率的な管理

複雑なエフェクトパイプラインでは、中間テクスチャの管理が重要です。Bevy 0.18では、`RenderGraph`が自動的にテクスチャのライフタイムを追跡し、再利用可能なバッファをプールから割り当てます。

以下は、中間バッファを効率的に使用する例です：

```rust
use bevy::render::render_graph::RenderGraphApp;
use bevy::render::render_resource::{Extent3d, TextureDescriptor, TextureDimension, TextureFormat, TextureUsages};

pub struct DofPlugin;

impl Plugin for DofPlugin {
    fn build(&self, app: &mut App) {
        app.add_systems(Startup, setup_dof_resources);
        
        let render_app = app.sub_app_mut(RenderApp);
        render_app
            .init_resource::<CocPipeline>()
            .add_render_graph_node::<CocPassNode>(
                Core3d,
                CocPassLabel,
            )
            .add_render_graph_edges(
                Core3d,
                (
                    Node3d::MainOpaquePass,
                    CocPassLabel,
                    Node3d::Bloom,
                ),
            );
    }
}

#[derive(Resource)]
struct IntermediateTextures {
    coc_texture: Handle<Image>,
    blur_temp: Handle<Image>,
}

fn setup_dof_resources(
    mut commands: Commands,
    mut images: ResMut<Assets<Image>>,
) {
    let size = Extent3d {
        width: 1920,
        height: 1080,
        depth_or_array_layers: 1,
    };

    let coc_texture = images.add(Image {
        texture_descriptor: TextureDescriptor {
            label: Some("coc_map"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format: TextureFormat::R16Float,
            usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        },
        ..default()
    });

    let blur_temp = images.add(Image {
        texture_descriptor: TextureDescriptor {
            label: Some("blur_temp"),
            size,
            mip_level_count: 1,
            sample_count: 1,
            dimension: TextureDimension::D2,
            format: TextureFormat::Rgba16Float,
            usage: TextureUsages::RENDER_ATTACHMENT | TextureUsages::TEXTURE_BINDING,
            view_formats: &[],
        },
        ..default()
    });

    commands.insert_resource(IntermediateTextures {
        coc_texture,
        blur_temp,
    });
}
```

この実装では、CoCマップには`R16Float`（単一チャンネル16ビット浮動小数点）、ブラー用の一時バッファには`Rgba16Float`を使用しています。`TextureUsages`に`RENDER_ATTACHMENT`と`TEXTURE_BINDING`の両方を指定することで、レンダーターゲットとしても入力テクスチャとしても使用できます。

## マルチパスエフェクトのパフォーマンス最適化

複雑なエフェクトパイプラインでは、パス間のGPU同期オーバーヘッドがボトルネックになります。Bevy 0.18では、以下の最適化手法が有効です：

### 1. Compute Shaderへのオフロード

従来のフラグメントシェーダーベースのポストエフェクトをCompute Shaderに置き換えることで、柔軟なスレッドグループ設定が可能になります。

```rust
use bevy::render::render_resource::{
    ComputePassDescriptor, ComputePipelineDescriptor,
};

pub struct BlurComputeNode {
    pipeline: CachedComputePipelineId,
}

impl Node for BlurComputeNode {
    fn run(
        &self,
        _graph: &mut RenderGraphContext,
        render_context: &mut RenderContext,
        world: &World,
    ) -> Result<(), NodeRunError> {
        let pipeline_cache = world.resource::<PipelineCache>();
        let Some(pipeline) = pipeline_cache.get_compute_pipeline(self.pipeline) else {
            return Ok(());
        };

        let mut compute_pass = render_context.command_encoder()
            .begin_compute_pass(&ComputePassDescriptor {
                label: Some("blur_compute_pass"),
                timestamp_writes: None,
            });

        compute_pass.set_pipeline(pipeline);
        // 1920x1080をタイルサイズ16x16で分割
        compute_pass.dispatch_workgroups(
            (1920 + 15) / 16,
            (1080 + 15) / 16,
            1,
        );

        Ok(())
    }
}
```

対応するCompute Shader（WGSL）は以下です：

```wgsl
@group(0) @binding(0) var input_texture: texture_2d<f32>;
@group(0) @binding(1) var output_texture: texture_storage_2d<rgba16float, write>;

const TILE_SIZE: u32 = 16u;

@compute @workgroup_size(16, 16, 1)
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
    let dims = textureDimensions(input_texture);
    if (global_id.x >= dims.x || global_id.y >= dims.y) {
        return;
    }

    // ガウシアンブラー（5x5カーネル）
    let weights = array<f32, 5>(
        0.06136, 0.24477, 0.38774, 0.24477, 0.06136
    );

    var color = vec4<f32>(0.0);
    for (var i = -2; i <= 2; i++) {
        let uv = vec2<i32>(i32(global_id.x) + i, i32(global_id.y));
        let sample = textureLoad(input_texture, uv, 0);
        color += sample * weights[i + 2];
    }

    textureStore(output_texture, global_id.xy, color);
}
```

Compute Shaderを使用することで、従来のフラグメントシェーダーと比較して**約20-30%の高速化**が期待できます（2026年4月のBevy公式パフォーマンステストによる）。

### 2. Render Graph の依存関係最適化

以下の状態遷移図は、DoFエフェクトにおける各パスの依存関係と実行順序を示しています。

```mermaid
stateDiagram-v2
    [*] --> MainPass
    MainPass --> CoCGeneration
    MainPass --> BlurHorizontal
    CoCGeneration --> BlurHorizontal
    BlurHorizontal --> BlurVertical
    BlurVertical --> CompositePass
    CoCGeneration --> CompositePass
    MainPass --> CompositePass
    CompositePass --> [*]

    note right of BlurHorizontal
        並列実行可能
        (CoC生成と独立)
    end note

    note right of CompositePass
        最終合成
        (全パス完了後)
    end note
```

この図から、`CoCGeneration`と`BlurHorizontal`は理論上並列実行可能ですが、実際には`BlurHorizontal`がメインパスの出力を必要とするため、依存関係があります。正しい依存関係を明示することで、Bevy 0.18のRender Graphは自動的に最適な実行順序を決定します。

```rust
render_app.add_render_graph_edges(
    Core3d,
    (
        Node3d::MainOpaquePass,
        CocPassLabel,
    ),
)
.add_render_graph_edges(
    Core3d,
    (
        Node3d::MainOpaquePass,
        BlurHorizontalLabel,
    ),
)
.add_render_graph_edges(
    Core3d,
    (
        BlurHorizontalLabel,
        BlurVerticalLabel,
    ),
)
.add_render_graph_edges(
    Core3d,
    (
        (CocPassLabel, BlurVerticalLabel, Node3d::MainOpaquePass),
        CompositeLabel,
    ),
);
```

このようにエッジを定義することで、`CompositeLabel`は3つのパスすべてが完了するまで待機します。

## デバッグとプロファイリング

カスタムレンダーパスのパフォーマンスを検証するには、Bevy 0.18の新しい`RenderGraph`可視化ツールが有効です。

```rust
use bevy::render::diagnostic::RenderGraphDiagnosticsPlugin;

fn main() {
    App::new()
        .add_plugins(DefaultPlugins)
        .add_plugins(RenderGraphDiagnosticsPlugin)
        .run();
}
```

このプラグインを有効にすると、実行時に各ノードのGPU実行時間がログに出力されます。さらに、環境変数`WGPU_TRACE=1`を設定すると、WGPUレベルのトレースが記録され、`chrome://tracing`で可視化できます。

```bash
WGPU_TRACE=1 cargo run --release
```

トレースファイルは`wgpu-trace/`ディレクトリに生成されます。このファイルをChromeの`chrome://tracing`にドラッグ&ドロップすることで、各パスの実行タイミングと依存関係を視覚的に確認できます。

## まとめ

Bevy 0.18のカスタムレンダーパス実装では、以下のポイントが重要です：

- **Declarative Render Graph API**により、複雑なパイプラインを宣言的に記述可能
- **中間バッファの自動管理**により、メモリ効率が向上（平均30%削減）
- **Compute Shaderへのオフロード**で、柔軟な並列処理とパフォーマンス向上（20-30%高速化）
- **依存関係の明示的な定義**により、Render Graphが自動的に最適な実行順序を決定
- **RenderGraph可視化ツール**と**WGPUトレース**により、詳細なプロファイリングが可能

これらの機能を活用することで、高品質なビジュアルエフェクトを効率的に実装できます。Bevy 0.18の新しいレンダリングアーキテクチャは、Unreal EngineやUnityの商用エンジンに匹敵する柔軟性を提供しており、今後のバージョンアップでさらなる最適化が期待されます。

## 参考リンク

- [Bevy 0.18 Release Notes | Official Bevy Blog](https://bevyengine.org/news/bevy-0-18/)
- [Render Graph Migration Guide | Bevy Documentation](https://docs.rs/bevy/0.18.0/bevy/render/render_graph/index.html)
- [Custom Render Pass Example | Bevy GitHub Repository](https://github.com/bevyengine/bevy/blob/v0.18.0/examples/shader/custom_render_pass.rs)
- [WGPU Compute Shader Best Practices | wgpu.rs Documentation](https://wgpu.rs/doc/wgpu/struct.ComputePass.html)
- [Depth of Field Implementation in Real-Time Rendering | GPU Gems 3](https://developer.nvidia.com/gpugems/gpugems3/part-iv-image-effects/chapter-28-practical-post-process-depth-field)