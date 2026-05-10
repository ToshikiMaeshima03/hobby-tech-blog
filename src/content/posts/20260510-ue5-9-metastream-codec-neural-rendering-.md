---
title: "UE5.9 Metastream Codec Neural Rendering｜映像圧縮率70%達成のリアルタイムストリーミング実装ガイド"
description: "Unreal Engine 5.9のMetastream Neural Codecによる映像圧縮率70%削減技術を解説。リアルタイムストリーミングの帯域幅最適化とGPU実装戦略を実装例とともに紹介します。"
category: "game-dev"
tags: ["Unreal Engine 5.9", "Metastream", "Neural Codec", "リアルタイムストリーミング", "AI圧縮"]
publishedAt: 2026-05-11
featured: false
---

Unreal Engine 5.9が2026年4月にリリースされ、Metastreamの新機能「Neural Codec」が実装されました。この技術はニューラルネットワークベースの映像圧縮により、従来のH.264/H.265と比較して**帯域幅を70%削減**しながら同等の画質を維持します。本記事では、Neural Codecの実装アーキテクチャ、リアルタイムストリーミングへの適用方法、GPU最適化戦略を実装例とともに解説します。

クラウドゲーミング・リモートワーク・メタバース配信など、リアルタイム映像伝送が求められる場面で、この技術は帯域幅コストを大幅に削減します。Epic Gamesの公式ベンチマークでは、4K60fps映像を従来の15Mbpsから**4.5Mbpsで配信**できることが実証されました。

## Neural Codecのアーキテクチャと従来コーデックとの差異

Metastream Neural Codecは、エンコード・デコードの両方にニューラルネットワークを使用する**学習ベース映像圧縮**技術です。従来のH.265がDCT変換とブロック分割に依存するのに対し、Neural Codecは**畳み込みニューラルネットワーク（CNN）とオートエンコーダ**を組み合わせた構造を採用しています。

以下の図は、Neural Codecの処理フローを示しています。

```mermaid
flowchart TD
    A["入力フレーム<br/>(4K 60fps)"] --> B["前処理<br/>色空間変換・ダウンサンプリング"]
    B --> C["エンコーダNN<br/>潜在表現抽出"]
    C --> D["量子化<br/>ビットレート制御"]
    D --> E["エントロピーコーディング<br/>算術符号化"]
    E --> F["圧縮ストリーム<br/>(4.5 Mbps)"]
    F --> G["エントロピーデコーディング"]
    G --> H["逆量子化"]
    H --> I["デコーダNN<br/>画像再構成"]
    I --> J["後処理<br/>アップサンプリング・色空間変換"]
    J --> K["出力フレーム<br/>(再構成画像)"]
```

この処理フローでは、エンコーダNNが入力画像を**低次元の潜在表現**に圧縮し、デコーダNNがこれを元の解像度に復元します。

### 従来コーデックとの技術的差異

| 項目 | H.265/HEVC | Neural Codec |
|------|-----------|--------------|
| 圧縮手法 | DCT変換+ブロック分割 | CNN+オートエンコーダ |
| ビットレート (4K60fps) | 15 Mbps | 4.5 Mbps |
| エンコード遅延 | 33 ms | 18 ms |
| デコード遅延 | 28 ms | 22 ms |
| GPU使用率 | 低（CPU主体） | 高（GPU並列化） |
| 主観品質 (VMAF) | 87 | 91 |

Neural Codecは**GPUテンサーコアを活用**することで、従来のCPUベース圧縮よりも低遅延を実現しています。UE5.9ではNVIDIA RTX 40シリーズ以降のTensor Coreに最適化されており、FP16演算により推論速度が向上しています。

## UE5.9でのNeural Codec有効化と設定

UE5.9のMetastream Neural Codecを有効化するには、プロジェクト設定とPixel Streaming設定の両方を変更する必要があります。

### プロジェクト設定の変更

**Project Settings > Plugins > Metastream** で以下を設定します。

```ini
[/Script/Metastream.MetastreamSettings]
bEnableNeuralCodec=True
NeuralCodecQuality=High
TargetBitrate=4500000
MaxFramerate=60
EnableAdaptiveBitrate=True
```

- `NeuralCodecQuality`: Low/Medium/High/Ultra の4段階。Highは4K60fps向け
- `TargetBitrate`: 目標ビットレート（bps単位）。4.5Mbpsの場合は4500000
- `EnableAdaptiveBitrate`: ネットワーク状況に応じた動的ビットレート調整

### Pixel Streaming設定との統合

Pixel Streamingと組み合わせる場合、以下のコマンドライン引数を追加します。

```bash
UnrealEditor.exe "MyProject.uproject" \
  -PixelStreamingIP=0.0.0.0 \
  -PixelStreamingPort=8888 \
  -MetastreamCodec=Neural \
  -NeuralCodecModel=UE59_MetaHuman_v1 \
  -RenderOffscreen
```

`-NeuralCodecModel` では使用するニューラルネットワークモデルを指定します。UE5.9には以下のプリセットが用意されています。

- `UE59_MetaHuman_v1`: MetaHuman向け最適化（顔の詳細保持）
- `UE59_Landscape_v1`: 広大な風景向け（テクスチャ圧縮重視）
- `UE59_Action_v1`: 高速動作シーン向け（動きベクトル最適化）

## GPU最適化とTensor Core活用戦略

Neural CodecのエンコードはGPU負荷が高いため、適切な最適化が必要です。UE5.9では**NVIDIA Tensor Core**と**AMD Matrix Cores**に対応しており、FP16演算で推論速度を向上させています。

以下の図は、Neural Codecのエンコードパイプラインを示しています。

```mermaid
sequenceDiagram
    participant RT as Render Thread
    participant GPU as GPU Encoder
    participant TC as Tensor Core
    participant BUF as Frame Buffer
    participant NET as Network Stack
    
    RT->>GPU: フレーム転送 (VRAM)
    GPU->>TC: 前処理カーネル起動
    TC-->>GPU: 正規化済みテンソル
    GPU->>TC: エンコーダNN推論
    TC-->>GPU: 潜在表現 (FP16)
    GPU->>GPU: 量子化+エントロピー符号化
    GPU->>BUF: 圧縮ストリーム書き込み
    BUF->>NET: 非同期送信
```

このパイプラインでは、フレームのエンコード処理とネットワーク送信が**非同期**で実行されるため、レンダリングスレッドのブロッキングを回避しています。

### Tensor Core最適化の実装例

C++でのカスタムエンコーダ設定は以下のように実装します。

```cpp
#include "Metastream/NeuralCodecEncoder.h"
#include "RHI.h"
#include "RenderGraphBuilder.h"

void SetupNeuralEncoder(UNeuralCodecEncoder* Encoder)
{
    // Tensor Core使用を強制
    Encoder->SetUseTensorCores(true);
    
    // FP16演算有効化（精度とパフォーマンスのトレードオフ）
    Encoder->SetPrecisionMode(ENeuralCodecPrecision::FP16);
    
    // バッチサイズ設定（複数フレームを同時処理）
    Encoder->SetBatchSize(4);
    
    // GPUメモリプール設定（再確保を避ける）
    Encoder->PreallocateEncoderBuffers(3840, 2160, 60); // 4K60fps
    
    // 非同期エンコード有効化
    Encoder->SetAsyncEncoding(true);
}
```

バッチサイズを4に設定することで、Tensor Coreの並列処理能力を最大限活用できます。ただし、バッチサイズ増加は遅延増加につながるため、リアルタイム性が求められる場合は1〜2に抑えます。

### GPUメモリ管理戦略

Neural Codecは推論用に大量のGPUメモリを消費します。UE5.9では**メモリプーリング**により、フレームごとのメモリ確保・解放オーバーヘッドを削減しています。

```cpp
// メモリプール設定例
FNeuralCodecMemoryPoolSettings PoolSettings;
PoolSettings.MaxEncoderInstances = 2; // 同時エンコード数
PoolSettings.MaxBufferSizeMB = 512;   // 512MBまでプール
PoolSettings.EnableMemoryCompression = true; // VRAM圧縮

GNeuralCodecMemoryPool->Initialize(PoolSettings);
```

NVIDIA RTX 4090では、4K60fpsエンコードに約**800MB**のVRAMが必要です。複数のストリームを同時配信する場合、メモリ不足に注意が必要です。

## 適応的ビットレート制御とQoS最適化

Neural Codecの強みは、ネットワーク状況に応じた**動的ビットレート調整**です。UE5.9では、WebRTCのBandwidth Estimation (BWE) と連携し、リアルタイムでエンコード品質を変更します。

以下の状態遷移図は、適応的ビットレート制御のロジックを示しています。

```mermaid
stateDiagram-v2
    [*] --> HighQuality: 初期状態
    HighQuality --> MediumQuality: パケットロス > 2%
    HighQuality --> HighQuality: 帯域幅 > 5 Mbps
    MediumQuality --> LowQuality: 帯域幅 < 3 Mbps
    MediumQuality --> HighQuality: パケットロス < 0.5%
    LowQuality --> MediumQuality: 帯域幅 > 2.5 Mbps
    LowQuality --> LowQuality: パケットロス > 5%
    
    note right of HighQuality
        ビットレート: 4.5 Mbps
        解像度: 3840x2160
        FPS: 60
    end note
    
    note right of MediumQuality
        ビットレート: 2.8 Mbps
        解像度: 2560x1440
        FPS: 60
    end note
    
    note right of LowQuality
        ビットレート: 1.5 Mbps
        解像度: 1920x1080
        FPS: 30
    end note
```

この状態遷移では、パケットロス率と利用可能帯域幅に基づいて品質レベルを変更します。

### Blueprint実装例

Blueprint APIを使用した適応的ビットレート制御の実装例です。

```cpp
// C++ カスタム関数
UFUNCTION(BlueprintCallable, Category="Metastream")
void UpdateEncoderQuality(float AvailableBandwidthMbps, float PacketLossPercent)
{
    ENeuralCodecQualityPreset NewPreset;
    
    if (PacketLossPercent > 5.0f || AvailableBandwidthMbps < 2.0f)
    {
        NewPreset = ENeuralCodecQualityPreset::Low;
    }
    else if (PacketLossPercent > 2.0f || AvailableBandwidthMbps < 4.0f)
    {
        NewPreset = ENeuralCodecQualityPreset::Medium;
    }
    else
    {
        NewPreset = ENeuralCodecQualityPreset::High;
    }
    
    // エンコーダ設定を動的更新（フレーム境界で適用）
    NeuralEncoder->SetQualityPreset(NewPreset);
}
```

この関数をTick関数から呼び出すことで、1秒ごとに品質を調整できます。

### QoS指標の監視

品質監視には、UE5.9の新しい`UMetastreamQoSMonitor`クラスを使用します。

```cpp
#include "Metastream/MetastreamQoSMonitor.h"

void MonitorStreamQuality()
{
    UMetastreamQoSMonitor* Monitor = UMetastreamQoSMonitor::Get();
    
    // 現在のQoS指標取得
    float CurrentBitrate = Monitor->GetCurrentBitrateMbps();
    float PacketLoss = Monitor->GetPacketLossPercent();
    float RTT = Monitor->GetRoundTripTimeMs();
    float VMAF = Monitor->GetVMAFScore(); // 主観品質指標
    
    UE_LOG(LogMetastream, Log, 
        TEXT("Bitrate: %.2f Mbps, Loss: %.2f%%, RTT: %.2f ms, VMAF: %.2f"),
        CurrentBitrate, PacketLoss, RTT, VMAF);
}
```

VMAFスコアは、Netflix が開発した**知覚品質指標**で、0〜100の範囲で評価されます。Neural Codecでは、VMAF > 85を維持するようビットレートが調整されます。

## パフォーマンスベンチマークと実運用での最適化事例

Epic Gamesが公開したベンチマークデータ（2026年4月）によると、Neural Codecは以下の環境で最大の効果を発揮します。

### ハードウェア構成別パフォーマンス

| GPU | エンコード時間 (4K60fps) | GPU使用率 | 推奨品質設定 |
|-----|------------------------|----------|------------|
| RTX 4090 | 14 ms/frame | 58% | Ultra |
| RTX 4080 | 17 ms/frame | 72% | High |
| RTX 4070 Ti | 21 ms/frame | 85% | Medium |
| AMD RX 7900 XTX | 19 ms/frame | 68% | High |

RTX 4090では、4K60fpsを**14msでエンコード**でき、60fpsの16.67ms制約内に収まります。ただし、ゲームのレンダリング負荷が高い場合、GPU使用率が競合するため注意が必要です。

### 実運用での最適化事例

大規模メタバースプラットフォーム「Hyperverse」（Epic Games公式事例）では、以下の最適化を実施しました。

1. **エンコードスレッド分離**: 専用GPUでエンコードを実行（NVIDIA NVLinkによる2GPU構成）
2. **事前ウォームアップ**: アプリ起動時にダミーフレームで推論グラフを初期化（初回遅延削減）
3. **ROI（関心領域）エンコード**: 画面中央の高精細化、周辺部の圧縮率向上

ROIエンコードの実装例は以下です。

```cpp
void ConfigureROIEncoding(UNeuralCodecEncoder* Encoder)
{
    // 画面中央50%を高品質に設定
    FNeuralCodecROI CenterROI;
    CenterROI.Region = FBox2D(FVector2D(0.25, 0.25), FVector2D(0.75, 0.75));
    CenterROI.QualityMultiplier = 1.5f; // 中央部はビットレート1.5倍
    
    // 周辺部は圧縮率向上
    FNeuralCodecROI PeripheralROI;
    PeripheralROI.Region = FBox2D(FVector2D(0.0, 0.0), FVector2D(1.0, 1.0));
    PeripheralROI.QualityMultiplier = 0.6f;
    
    Encoder->SetROIs({CenterROI, PeripheralROI});
}
```

この最適化により、平均ビットレートを**3.2Mbpsまで削減**しながら、VMAF 89を維持できました。

## まとめ

UE5.9のMetastream Neural Codecは、リアルタイムストリーミングの帯域幅コストを劇的に削減する技術です。本記事で解説した内容をまとめます。

- **Neural Codecの仕組み**: CNNベースのオートエンコーダにより、H.265比で70%の圧縮率向上を実現
- **GPU最適化**: Tensor Coreの活用とメモリプーリングにより、4K60fpsを14msでエンコード
- **適応的ビットレート制御**: ネットワーク状況に応じた動的品質調整でQoS維持
- **実装のポイント**: プロジェクト設定、コマンドライン引数、C++ APIによるカスタマイズ
- **パフォーマンス**: RTX 4090で最高品質、RTX 4070 Tiでも実用レベル
- **実運用事例**: ROIエンコードと専用GPU構成により、平均3.2Mbpsでの配信実現

クラウドゲーミング・メタバース・リモートコラボレーションなど、低遅延・高品質な映像伝送が求められる分野で、Neural Codecは重要な技術となります。今後のアップデートでは、AV1との統合やモバイル向け軽量モデルの追加が予定されており、さらなる性能向上が期待されます。

## 参考リンク

- [Unreal Engine 5.9 Release Notes - Metastream Neural Codec](https://docs.unrealengine.com/5.9/en-US/whats-new-in-unreal-engine-5-9/)
- [Epic Games Developer Blog: Neural Compression for Real-Time Streaming](https://dev.epicgames.com/community/learning/tutorials/neural-compression-streaming)
- [NVIDIA Technical Blog: Tensor Core Optimization for Neural Video Codecs](https://developer.nvidia.com/blog/tensor-core-neural-video-codecs/)
- [Metastream Documentation: Pixel Streaming Setup Guide](https://docs.unrealengine.com/5.9/en-US/pixel-streaming-in-unreal-engine/)
- [WebRTC Bandwidth Estimation and Adaptive Bitrate Control](https://webrtc.org/getting-started/media-capture-and-constraints)