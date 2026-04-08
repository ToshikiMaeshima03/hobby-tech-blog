---
title: "Vulkan VK_KHR_synchronization2 拡張機能で実現する高度なGPU同期制御【2026年版】"
description: "Vulkan 1.3にコア統合されたVK_KHR_synchronization2拡張機能の実装ガイド。レガシーAPIとの比較、実践的なコード例、パフォーマンス最適化手法を解説"
category: "low-level"
tags: ["Vulkan", "GPU", "同期制御", "グラフィックスAPI"]
publishedAt: 2026-04-08
featured: false
---

Vulkanのグラフィックスパイプライン開発において、GPU同期制御は最も複雑で間違いやすい領域の一つです。レガシーなバリア機構では、パイプラインステージとアクセスフラグが分離された構造で指定されるため、開発者が誤った依存関係を記述してしまうケースが頻発していました。

VK_KHR_synchronization2拡張機能は、こうした課題を根本から解決するために設計された次世代同期APIです。Vulkan 1.3ではコアAPIとして正式統合され、2026年現在、すべての主要GPUベンダーでサポートされています。

この記事では、synchronization2が解決する具体的な課題、レガシーAPIとの構造的な違い、そして実装におけるベストプラクティスを、実行可能なコード例とともに解説します。

## レガシー同期APIの構造的課題とsynchronization2による解決

従来のVulkanバリア機構では、`vkCmdPipelineBarrier()`に対してパイプラインステージマスクを**別々のパラメータ**として渡す必要がありました。

```cpp
// レガシーAPI：ステージとアクセスフラグが分離している
VkImageMemoryBarrier barrier = {};
barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER;
barrier.srcAccessMask = VK_ACCESS_COLOR_ATTACHMENT_WRITE_BIT;
barrier.dstAccessMask = VK_ACCESS_SHADER_READ_BIT;
barrier.oldLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
// ... その他の設定

vkCmdPipelineBarrier(
    commandBuffer,
    VK_PIPELINE_STAGE_COLOR_ATTACHMENT_OUTPUT_BIT,  // srcStageMask（バリア構造体の外）
    VK_PIPELINE_STAGE_FRAGMENT_SHADER_BIT,           // dstStageMask（バリア構造体の外）
    0,
    0, nullptr,
    0, nullptr,
    1, &barrier
);
```

この設計には以下の問題がありました：

- **意味的結合の欠如**：`srcAccessMask`は論理的に`srcStageMask`と結びついているべきなのに、構造的に分離されている
- **デバッグの困難さ**：バリア検証エラーが発生した際、どのステージマスクとアクセスマスクの組み合わせが誤っているのか特定しづらい
- **32ビット制限**：パイプラインステージとアクセスフラグが32ビット列挙型で定義されており、新しいステージやアクセスタイプを追加する余地がなかった

synchronization2では、これらすべてを**単一の`VkDependencyInfo`構造体**に統合します：

```cpp
// synchronization2：ステージとアクセスが構造的に結合
VkImageMemoryBarrier2 barrier = {};
barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
barrier.srcStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
barrier.srcAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
barrier.dstStageMask = VK_PIPELINE_STAGE_2_FRAGMENT_SHADER_BIT;
barrier.dstAccessMask = VK_ACCESS_2_SHADER_READ_BIT;
barrier.oldLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
barrier.newLayout = VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
// ... その他の設定

VkDependencyInfo dependencyInfo = {};
dependencyInfo.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
dependencyInfo.imageMemoryBarrierCount = 1;
dependencyInfo.pImageMemoryBarriers = &barrier;

vkCmdPipelineBarrier2(commandBuffer, &dependencyInfo);
```

この変更により、ステージとアクセスの関係が**構造体のメンバーとして**明示され、コードレビューやデバッグが劇的に容易になります。

## 64ビット拡張によるステージ・アクセスフラグの未来対応

レガシーAPIでは`VkPipelineStageFlagBits`と`VkAccessFlagBits`が32ビット列挙型でしたが、既に定義済みのビットが枯渇しつつありました。

synchronization2では、`VkPipelineStageFlags2`と`VkAccessFlags2`が**64ビット型**として定義されています：

```cpp
typedef VkFlags64 VkPipelineStageFlags2;
typedef VkFlags64 VkAccessFlags2;
```

これにより、将来的な拡張に対応できるだけでなく、新しいステージが追加されています：

| 新ステージ | 用途 |
|-----------|------|
| `VK_PIPELINE_STAGE_2_COPY_BIT` | 明示的なコピー操作の分離 |
| `VK_PIPELINE_STAGE_2_RESOLVE_BIT` | MSAAリゾルブ操作の明示化 |
| `VK_PIPELINE_STAGE_2_BLIT_BIT` | Blitコマンドの専用ステージ |
| `VK_PIPELINE_STAGE_2_CLEAR_BIT` | クリア操作の分離 |

これらのステージを使うことで、より細かい粒度でGPU依存関係を記述できます。たとえば、レンダリング結果をコピーする際に、以下のように正確に依存関係を表現できます：

```cpp
VkImageMemoryBarrier2 copyBarrier = {};
copyBarrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
copyBarrier.srcStageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
copyBarrier.srcAccessMask = VK_ACCESS_2_COLOR_ATTACHMENT_WRITE_BIT;
copyBarrier.dstStageMask = VK_PIPELINE_STAGE_2_COPY_BIT;  // 明示的なコピーステージ
copyBarrier.dstAccessMask = VK_ACCESS_2_TRANSFER_READ_BIT;
copyBarrier.oldLayout = VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
copyBarrier.newLayout = VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL;
// ... 画像リソース設定

VkDependencyInfo depInfo = {};
depInfo.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
depInfo.imageMemoryBarrierCount = 1;
depInfo.pImageMemoryBarriers = &copyBarrier;

vkCmdPipelineBarrier2(commandBuffer, &depInfo);
vkCmdCopyImage(commandBuffer, srcImage, VK_IMAGE_LAYOUT_TRANSFER_SRC_OPTIMAL, 
               dstImage, VK_IMAGE_LAYOUT_TRANSFER_DST_OPTIMAL, 1, &copyRegion);
```

## イベントベース同期の強化：vkCmdSetEvent2とバリア統合

レガシーAPIでは、`vkCmdSetEvent()`はイベントのシグナルのみを行い、実際のメモリバリアは`vkCmdWaitEvents()`で指定していました。これにより、ドライバはイベント待機時まで必要なキャッシュフラッシュ操作を遅延させざるを得ませんでした。

synchronization2の`vkCmdSetEvent2()`では、**イベント設定時にバリア情報を渡せる**ようになりました：

```cpp
VkMemoryBarrier2 memoryBarrier = {};
memoryBarrier.sType = VK_STRUCTURE_TYPE_MEMORY_BARRIER_2;
memoryBarrier.srcStageMask = VK_PIPELINE_STAGE_2_COMPUTE_SHADER_BIT;
memoryBarrier.srcAccessMask = VK_ACCESS_2_SHADER_WRITE_BIT;
memoryBarrier.dstStageMask = VK_PIPELINE_STAGE_2_COMPUTE_SHADER_BIT;
memoryBarrier.dstAccessMask = VK_ACCESS_2_SHADER_READ_BIT;

VkDependencyInfo setEventDep = {};
setEventDep.sType = VK_STRUCTURE_TYPE_DEPENDENCY_INFO;
setEventDep.memoryBarrierCount = 1;
setEventDep.pMemoryBarriers = &memoryBarrier;

vkCmdSetEvent2(commandBuffer, event, &setEventDep);
```

この変更により、ドライバは**イベント設定時点で非同期にキャッシュフラッシュやレイアウト遷移を開始**できるようになり、特に複雑なコンピュートワークロードでのパフォーマンスが向上します。

AMD GPUOpenの解説によれば、この機構により、重いコンピュートシェーダが実行中でも並行してキャッシュ制御操作を進められるため、待機レイテンシが削減されます。

## 汎用レイアウトによるレイアウト遷移の簡略化

レガシーAPIでは、画像のフォーマットや用途に応じて、適切なレイアウトを手動で選択する必要がありました：

- Depth/Stencil画像には`VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL`
- カラー画像には`VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL`
- 読み取り専用には`VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL`

synchronization2では、**コンテキスト依存の汎用レイアウト**が導入されました：

```cpp
// 汎用アタッチメントレイアウト（フォーマットに応じて自動選択）
VK_IMAGE_LAYOUT_ATTACHMENT_OPTIMAL

// 汎用読み取り専用レイアウト
VK_IMAGE_LAYOUT_READ_ONLY_OPTIMAL
```

これらのレイアウトは、画像フォーマット（Depth/Stencil/Color）と使用コンテキストから**ドライバが自動的に最適なレイアウトを選択**します。

実装例：

```cpp
// レガシーAPI：フォーマットに応じて手動切り替え
VkImageLayout GetOptimalLayout(VkFormat format, bool isAttachment) {
    if (isAttachment) {
        if (format == VK_FORMAT_D32_SFLOAT || format == VK_FORMAT_D24_UNORM_S8_UINT) {
            return VK_IMAGE_LAYOUT_DEPTH_STENCIL_ATTACHMENT_OPTIMAL;
        } else {
            return VK_IMAGE_LAYOUT_COLOR_ATTACHMENT_OPTIMAL;
        }
    }
    return VK_IMAGE_LAYOUT_SHADER_READ_ONLY_OPTIMAL;
}

// synchronization2：汎用レイアウトで統一
VkImageMemoryBarrier2 barrier = {};
barrier.oldLayout = VK_IMAGE_LAYOUT_UNDEFINED;
barrier.newLayout = VK_IMAGE_LAYOUT_ATTACHMENT_OPTIMAL;  // フォーマット自動判定
```

この機能により、マルチフォーマット対応のレンダリングエンジンで、レイアウト管理ロジックが大幅に簡略化されます。

## キューサブミットの構造改善：VkSubmitInfo2による配列の統一

レガシーAPIの`vkQueueSubmit()`では、コマンドバッファとセマフォが**別々の配列**に分散していました：

```cpp
// レガシーAPI：情報が複数の構造体に分散
VkSubmitInfo submitInfo = {};
submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
submitInfo.waitSemaphoreCount = 1;
submitInfo.pWaitSemaphores = &waitSemaphore;
submitInfo.pWaitDstStageMask = &waitStage;
submitInfo.commandBufferCount = 1;
submitInfo.pCommandBuffers = &commandBuffer;
submitInfo.signalSemaphoreCount = 1;
submitInfo.pSignalSemaphores = &signalSemaphore;

vkQueueSubmit(queue, 1, &submitInfo, fence);
```

synchronization2の`vkQueueSubmit2()`では、セマフォごとに構造体を用意し、ステージマスクも統合されます：

```cpp
// synchronization2：各同期オブジェクトが専用構造体を持つ
VkSemaphoreSubmitInfo waitSemaphoreInfo = {};
waitSemaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_SUBMIT_INFO;
waitSemaphoreInfo.semaphore = waitSemaphore;
waitSemaphoreInfo.stageMask = VK_PIPELINE_STAGE_2_COLOR_ATTACHMENT_OUTPUT_BIT;
waitSemaphoreInfo.value = 0;  // タイムラインセマフォ対応

VkSemaphoreSubmitInfo signalSemaphoreInfo = {};
signalSemaphoreInfo.sType = VK_STRUCTURE_TYPE_SEMAPHORE_SUBMIT_INFO;
signalSemaphoreInfo.semaphore = signalSemaphore;
signalSemaphoreInfo.stageMask = VK_PIPELINE_STAGE_2_ALL_COMMANDS_BIT;
signalSemaphoreInfo.value = 0;

VkCommandBufferSubmitInfo cmdBufferInfo = {};
cmdBufferInfo.sType = VK_STRUCTURE_TYPE_COMMAND_BUFFER_SUBMIT_INFO;
cmdBufferInfo.commandBuffer = commandBuffer;

VkSubmitInfo2 submitInfo2 = {};
submitInfo2.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO_2;
submitInfo2.waitSemaphoreInfoCount = 1;
submitInfo2.pWaitSemaphoreInfos = &waitSemaphoreInfo;
submitInfo2.commandBufferInfoCount = 1;
submitInfo2.pCommandBufferInfos = &cmdBufferInfo;
submitInfo2.signalSemaphoreInfoCount = 1;
submitInfo2.pSignalSemaphoreInfos = &signalSemaphoreInfo;

vkQueueSubmit2(queue, 1, &submitInfo2, fence);
```

この構造により、以下の利点が得られます：

- **タイムラインセマフォとの統合**：`value`フィールドでバイナリ/タイムラインセマフォを統一的に扱える
- **デバッグの容易さ**：各セマフォのステージマスクが構造体に含まれるため、トレース時に情報が自己完結
- **拡張性**：将来的な拡張で新しいフィールドを追加しやすい

## 実装移行のベストプラクティスと検証ツール

既存のVulkanプロジェクトをsynchronization2に移行する際は、以下のステップを推奨します。

### 1. 拡張機能の有効化とフィーチャーチェック

```cpp
// デバイス作成時に拡張機能を有効化（Vulkan 1.3の場合は不要）
const char* extensions[] = { VK_KHR_SYNCHRONIZATION_2_EXTENSION_NAME };

VkPhysicalDeviceSynchronization2FeaturesKHR sync2Features = {};
sync2Features.sType = VK_STRUCTURE_TYPE_PHYSICAL_DEVICE_SYNCHRONIZATION_2_FEATURES_KHR;
sync2Features.synchronization2 = VK_TRUE;

VkDeviceCreateInfo deviceInfo = {};
deviceInfo.sType = VK_STRUCTURE_TYPE_DEVICE_CREATE_INFO;
deviceInfo.pNext = &sync2Features;
deviceInfo.enabledExtensionCount = 1;
deviceInfo.ppEnabledExtensionNames = extensions;
// ... その他の設定

vkCreateDevice(physicalDevice, &deviceInfo, nullptr, &device);
```

Vulkan 1.3以降では、KHRサフィックスなしのコアAPIとして利用可能です。

### 2. バリアの段階的移行

一度にすべてのバリアを書き換えるのではなく、レンダーパス単位で移行することで、問題の切り分けが容易になります：

```cpp
// ヘルパー関数で移行を簡素化
VkImageMemoryBarrier2 CreateImageBarrier2(
    VkImage image,
    VkPipelineStageFlags2 srcStage,
    VkAccessFlags2 srcAccess,
    VkImageLayout oldLayout,
    VkPipelineStageFlags2 dstStage,
    VkAccessFlags2 dstAccess,
    VkImageLayout newLayout
) {
    VkImageMemoryBarrier2 barrier = {};
    barrier.sType = VK_STRUCTURE_TYPE_IMAGE_MEMORY_BARRIER_2;
    barrier.srcStageMask = srcStage;
    barrier.srcAccessMask = srcAccess;
    barrier.dstStageMask = dstStage;
    barrier.dstAccessMask = dstAccess;
    barrier.oldLayout = oldLayout;
    barrier.newLayout = newLayout;
    barrier.image = image;
    barrier.subresourceRange = { VK_IMAGE_ASPECT_COLOR_BIT, 0, 1, 0, 1 };
    return barrier;
}
```

### 3. Validation Layerの活用

LunarGのVulkan SDKに含まれる**Synchronization Validation**レイヤーは、synchronization2の誤用を検出します：

```bash
# 環境変数で有効化
export VK_INSTANCE_LAYERS=VK_LAYER_KHRONOS_validation
export VK_LAYER_ENABLES=VK_VALIDATION_FEATURE_ENABLE_SYNCHRONIZATION_VALIDATION_EXT
```

このレイヤーは、以下のような誤りを検出します：

- ステージマスクとアクセスマスクの不整合（例：`FRAGMENT_SHADER`ステージで`VERTEX_ATTRIBUTE_READ`アクセス）
- 書き込み後読み取り（WAR）ハザード
- レイアウト遷移の欠落

## まとめ：synchronization2がもたらす開発体験の向上

VK_KHR_synchronization2拡張機能は、単なるAPIの構文変更ではなく、Vulkan同期制御の**概念モデルそのものを改善**するものです。

**主な利点：**

- ステージとアクセスフラグの構造的結合により、バリアの意図が明確化
- 64ビット拡張による将来的な拡張性の確保
- イベント設定時のバリア情報提供による、ドライバの非同期最適化の促進
- 汎用レイアウトによる、マルチフォーマット対応コードの簡素化
- タイムラインセマフォとの統一的な扱いによる、複雑なキュー同期の管理容易化

**移行推奨タイミング：**

- 新規Vulkanプロジェクト：最初からsynchronization2を採用
- 既存プロジェクト：メジャーリファクタリングのタイミングで段階的に移行
- 複雑なコンピュートワークロード：イベントベース同期の恩恵が大きいため優先的に移行

2026年現在、Vulkan 1.3がサポートされているすべての環境でsynchronization2が利用可能です。レガシーAPIは当面サポートされますが、新規開発ではsynchronization2の採用を強く推奨します。

**参考リソース：**

- [Vulkan Documentation: VK_KHR_synchronization2](https://docs.vulkan.org/guide/latest/extensions/VK_KHR_synchronization2.html)
- [Khronos Vulkan Guide: Synchronization2](https://github.com/KhronosGroup/Vulkan-Guide/blob/main/chapters/extensions/VK_KHR_synchronization2.adoc)
- [Synchronization Examples](https://github.com/KhronosGroup/Vulkan-Docs/wiki/Synchronization-Examples)
- [AMD GPUOpen: Vulkan Synchronization2 Support](https://gpuopen.com/news/vulkan-sync2-support/)
- [LunarG: Synchronization Validation](https://www.lunarg.com/new-vulkan-sdks-support-synchronization2/)