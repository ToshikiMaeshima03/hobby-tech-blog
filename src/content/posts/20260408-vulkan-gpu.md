---
title: "Vulkanメモリアロケータの設計パターン完全ガイド｜効率的なGPUメモリ管理の実装"
description: "Vulkanにおけるメモリアロケータの設計パターンを解説。VMA、カスタムプール、リニアアロケータ、ディスクリプタ管理まで実装例付きで網羅します。"
category: "low-level"
tags: ["Vulkan", "GPU", "メモリ管理", "低レイヤ"]
publishedAt: 2026-04-08
featured: false
---

Vulkanでグラフィックスアプリケーションを開発する際、多くのエンジニアが直面する最大の課題の一つがメモリ管理です。OpenGLとは異なり、Vulkanではバッファやテクスチャのメモリ割り当てを開発者自身が明示的に制御する必要があります。この記事では、Vulkan Memory Allocator（VMA）の活用から、カスタムアロケータの設計パターン、ディスクリプタセットの効率的な管理まで、実践的なメモリ管理手法を解説します。

## Vulkanメモリ管理の複雑性と課題

Vulkanでは、バッファやイメージを作成する際に以下のステップを踏む必要があります：

```cpp
// バッファ作成
VkBufferCreateInfo bufferInfo{};
bufferInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
bufferInfo.size = 1024 * 1024; // 1MB
bufferInfo.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;

VkBuffer buffer;
vkCreateBuffer(device, &bufferInfo, nullptr, &buffer);

// メモリ要件の取得
VkMemoryRequirements memRequirements;
vkGetBufferMemoryRequirements(device, buffer, &memRequirements);

// 適切なメモリタイプの検索
uint32_t memoryTypeIndex = findMemoryType(
    memRequirements.memoryTypeBits,
    VK_MEMORY_PROPERTY_DEVICE_LOCAL_BIT
);

// メモリの割り当て
VkMemoryAllocateInfo allocInfo{};
allocInfo.sType = VK_STRUCTURE_TYPE_MEMORY_ALLOCATE_INFO;
allocInfo.allocationSize = memRequirements.size;
allocInfo.memoryTypeIndex = memoryTypeIndex;

VkDeviceMemory memory;
vkAllocateMemory(device, &allocInfo, nullptr, &memory);

// バッファとメモリのバインド
vkBindBufferMemory(device, buffer, memory, 0);
```

この方法には以下の問題があります：

- **アライメント要件がGPUごとに異なる**：NVIDIA、AMD、Intelでメモリアライメント仕様が異なり、手動管理は困難
- **割り当て回数の制限**：多くのGPUドライバでは同時に4096個程度のメモリ割り当てしか許可されない
- **フラグメンテーション**：小さなバッファを個別に割り当てるとメモリが断片化
- **パフォーマンス低下**：vkAllocateMemoryは重い操作で、フレーム中に頻繁に呼ぶとFPS低下の原因に

## Vulkan Memory Allocator（VMA）の活用

AMDのGPUOpenプロジェクトが提供する[Vulkan Memory Allocator（VMA）](https://gpuopen.com/vulkan-memory-allocator/)は、これらの課題を解決する実績あるライブラリです。2026年現在、数千のプロジェクトで採用され、業界標準となっています。

### VMAの基本的な使い方

```cpp
// VMAアロケータの初期化
VmaAllocatorCreateInfo allocatorInfo{};
allocatorInfo.vulkanApiVersion = VK_API_VERSION_1_3;
allocatorInfo.physicalDevice = physicalDevice;
allocatorInfo.device = device;
allocatorInfo.instance = instance;

VmaAllocator allocator;
vmaCreateAllocator(&allocatorInfo, &allocator);

// バッファとメモリを一度に作成
VkBufferCreateInfo bufferInfo{};
bufferInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
bufferInfo.size = 1024 * 1024;
bufferInfo.usage = VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;

VmaAllocationCreateInfo allocInfo{};
allocInfo.usage = VMA_MEMORY_USAGE_AUTO;
allocInfo.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                  VMA_ALLOCATION_CREATE_HOST_ACCESS_ALLOW_TRANSFER_INSTEAD_BIT;

VkBuffer buffer;
VmaAllocation allocation;
vmaCreateBuffer(allocator, &bufferInfo, &allocInfo, 
                &buffer, &allocation, nullptr);

// 使用後の解放
vmaDestroyBuffer(allocator, buffer, allocation);
vmaDestroyAllocator(allocator);
```

[VMAの公式ドキュメント](https://gpuopen-librariesandsdks.github.io/VulkanMemoryAllocator/html/)によると、この方法には以下のメリットがあります：

- バッファ作成、メモリ割り当て、バインドが1回の呼び出しで完結
- アライメント要件を自動処理
- 内部でサブアロケーションを行い、vkAllocateMemoryの呼び出しを最小化
- マルチスレッド対応の内部同期機構

### VMAのメモリタイプ選択戦略

VMAは用途に応じて最適なメモリタイプを自動選択します：

```cpp
// GPU専用メモリ（最高速度、CPUからアクセス不可）
VmaAllocationCreateInfo allocInfo{};
allocInfo.usage = VMA_MEMORY_USAGE_AUTO_PREFER_DEVICE;

// CPU書き込み→GPU読み込み（ステージングバッファ）
allocInfo.usage = VMA_MEMORY_USAGE_AUTO;
allocInfo.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT;

// GPU書き込み→CPU読み込み（スクリーンショット、クエリ結果）
allocInfo.usage = VMA_MEMORY_USAGE_AUTO;
allocInfo.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_RANDOM_BIT;

// 統合GPU向け最適化（Intel内蔵GPU等）
allocInfo.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                  VMA_ALLOCATION_CREATE_HOST_ACCESS_ALLOW_TRANSFER_INSTEAD_BIT;
```

最後のフラグ組み合わせは、`DEVICE_LOCAL`かつ`HOST_VISIBLE`なメモリを優先し、利用不可能な場合は`DEVICE_LOCAL`のみにフォールバックします。これにより統合GPUでの転送コマンド削減が可能です。

## カスタムアロケータ設計パターン

VMAは優れたライブラリですが、特定の用途では専用アロケータが有効です。以下は代表的な設計パターンです。

### リニアアロケータ（Linear Allocator）

1フレーム内で確保・解放を繰り返す一時バッファに最適です：

```cpp
class LinearAllocator {
    VkBuffer buffer;
    VmaAllocation allocation;
    void* mappedData;
    size_t offset;
    size_t capacity;

public:
    LinearAllocator(VmaAllocator allocator, size_t size) 
        : offset(0), capacity(size) {
        
        VkBufferCreateInfo bufferInfo{};
        bufferInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        bufferInfo.size = size;
        bufferInfo.usage = VK_BUFFER_USAGE_UNIFORM_BUFFER_BIT | 
                           VK_BUFFER_USAGE_VERTEX_BUFFER_BIT;
        
        VmaAllocationCreateInfo allocInfo{};
        allocInfo.usage = VMA_MEMORY_USAGE_AUTO;
        allocInfo.flags = VMA_ALLOCATION_CREATE_HOST_ACCESS_SEQUENTIAL_WRITE_BIT |
                          VMA_ALLOCATION_CREATE_MAPPED_BIT;
        
        VmaAllocationInfo allocResult;
        vmaCreateBuffer(allocator, &bufferInfo, &allocInfo, 
                        &buffer, &allocation, &allocResult);
        mappedData = allocResult.pMappedData;
    }

    // アライメント考慮した割り当て
    std::pair<void*, size_t> allocate(size_t size, size_t alignment) {
        size_t alignedOffset = (offset + alignment - 1) & ~(alignment - 1);
        
        if (alignedOffset + size > capacity) {
            return {nullptr, 0}; // 容量不足
        }
        
        void* ptr = static_cast<char*>(mappedData) + alignedOffset;
        size_t resultOffset = alignedOffset;
        offset = alignedOffset + size;
        
        return {ptr, resultOffset};
    }

    // フレーム終了時にリセット
    void reset() {
        offset = 0;
    }
};
```

このパターンは[Kyle Halladayの解説](https://kylehalladay.com/blog/tutorial/2017/12/13/Custom-Allocators-Vulkan.html)でも推奨されており、動的Uniform Buffer（毎フレーム変わる行列等）の管理に特に有効です。

### プールアロケータ（Pool Allocator）

同サイズのオブジェクトを頻繁に作成・破棄する場合に効率的です：

```cpp
class PoolAllocator {
    struct Block {
        VkBuffer buffer;
        VmaAllocation allocation;
        bool inUse;
    };
    
    std::vector<Block> blocks;
    size_t blockSize;
    VmaAllocator allocator;

public:
    PoolAllocator(VmaAllocator alloc, size_t size, size_t initialCount) 
        : allocator(alloc), blockSize(size) {
        blocks.reserve(initialCount);
        for (size_t i = 0; i < initialCount; ++i) {
            blocks.push_back(createBlock());
        }
    }

    VkBuffer acquire() {
        for (auto& block : blocks) {
            if (!block.inUse) {
                block.inUse = true;
                return block.buffer;
            }
        }
        
        // プール拡張
        Block newBlock = createBlock();
        newBlock.inUse = true;
        blocks.push_back(newBlock);
        return newBlock.buffer;
    }

    void release(VkBuffer buffer) {
        for (auto& block : blocks) {
            if (block.buffer == buffer) {
                block.inUse = false;
                return;
            }
        }
    }

private:
    Block createBlock() {
        VkBufferCreateInfo bufferInfo{};
        bufferInfo.sType = VK_STRUCTURE_TYPE_BUFFER_CREATE_INFO;
        bufferInfo.size = blockSize;
        bufferInfo.usage = VK_BUFFER_USAGE_STORAGE_BUFFER_BIT;
        
        VmaAllocationCreateInfo allocInfo{};
        allocInfo.usage = VMA_MEMORY_USAGE_AUTO_PREFER_DEVICE;
        
        Block block;
        block.inUse = false;
        vmaCreateBuffer(allocator, &bufferInfo, &allocInfo, 
                        &block.buffer, &block.allocation, nullptr);
        return block;
    }
};
```

### ステージングバッファ管理

DEVICE_LOCALメモリへのデータ転送は、ステージングバッファを経由します：

```cpp
class StagingBufferManager {
    struct StagingBuffer {
        VkBuffer buffer;
        VmaAllocation allocation;
        void* mappedData;
        VkFence fence;
        uint64_t frameUsed;
    };
    
    std::vector<StagingBuffer> buffers;
    VmaAllocator allocator;
    VkDevice device;
    uint64_t currentFrame = 0;

public:
    void* allocateStaging(size_t size, VkBuffer& outBuffer, size_t& outOffset) {
        // 再利用可能なバッファを検索
        for (auto& sb : buffers) {
            if (vkGetFenceStatus(device, sb.fence) == VK_SUCCESS) {
                // 前回の転送完了済み
                vkResetFences(device, 1, &sb.fence);
                sb.frameUsed = currentFrame;
                outBuffer = sb.buffer;
                outOffset = 0;
                return sb.mappedData;
            }
        }
        
        // 新規作成
        StagingBuffer sb = createStagingBuffer(size);
        buffers.push_back(sb);
        outBuffer = sb.buffer;
        outOffset = 0;
        return sb.mappedData;
    }

    void submitTransfer(VkCommandBuffer cmd, VkBuffer stagingBuffer) {
        // 対応するfenceを見つけて転送完了を追跡
        for (auto& sb : buffers) {
            if (sb.buffer == stagingBuffer) {
                // コマンドバッファ送信時にfenceを渡す
                VkSubmitInfo submitInfo{};
                submitInfo.sType = VK_STRUCTURE_TYPE_SUBMIT_INFO;
                submitInfo.commandBufferCount = 1;
                submitInfo.pCommandBuffers = &cmd;
                
                vkQueueSubmit(queue, 1, &submitInfo, sb.fence);
                break;
            }
        }
    }

    void cleanup() {
        // 3フレーム以上前のバッファを削除
        buffers.erase(
            std::remove_if(buffers.begin(), buffers.end(),
                [this](const StagingBuffer& sb) {
                    return currentFrame - sb.frameUsed > 3;
                }),
            buffers.end()
        );
        currentFrame++;
    }
};
```

## ディスクリプタセット管理パターン

ディスクリプタセットのメモリ管理も重要です。[効率的なVulkanレンダラーの実装](https://zeux.io/2020/02/27/writing-an-efficient-vulkan-renderer/)によると、以下のパターンが推奨されます。

### サイズクラス別プール管理

```cpp
enum class DescriptorPoolSize {
    Small,   // テクスチャ1-2枚のマテリアル
    Medium,  // テクスチャ3-8枚の標準シェーダ
    Large    // 大量のテクスチャを使うポストプロセス
};

class DescriptorAllocator {
    struct PoolSizeRatio {
        VkDescriptorType type;
        float ratio;
    };
    
    static constexpr PoolSizeRatio smallPoolRatios[] = {
        { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1.0f },
        { VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 2.0f }
    };
    
    static constexpr PoolSizeRatio largePoolRatios[] = {
        { VK_DESCRIPTOR_TYPE_UNIFORM_BUFFER, 1.0f },
        { VK_DESCRIPTOR_TYPE_COMBINED_IMAGE_SAMPLER, 8.0f },
        { VK_DESCRIPTOR_TYPE_STORAGE_IMAGE, 4.0f }
    };

    struct DescriptorPool {
        VkDescriptorPool pool;
        uint32_t allocatedSets;
        uint32_t maxSets;
    };
    
    std::unordered_map<DescriptorPoolSize, std::vector<DescriptorPool>> pools;
    std::vector<VkDescriptorPool> usedPools; // 現在フレームで使用中

public:
    VkDescriptorSet allocate(VkDescriptorSetLayout layout, DescriptorPoolSize sizeClass) {
        auto& poolList = pools[sizeClass];
        
        // 空きのあるプールを検索
        for (auto& pool : poolList) {
            if (pool.allocatedSets < pool.maxSets) {
                VkDescriptorSetAllocateInfo allocInfo{};
                allocInfo.sType = VK_STRUCTURE_TYPE_DESCRIPTOR_SET_ALLOCATE_INFO;
                allocInfo.descriptorPool = pool.pool;
                allocInfo.descriptorSetCount = 1;
                allocInfo.pSetLayouts = &layout;
                
                VkDescriptorSet set;
                if (vkAllocateDescriptorSets(device, &allocInfo, &set) == VK_SUCCESS) {
                    pool.allocatedSets++;
                    usedPools.push_back(pool.pool);
                    return set;
                }
            }
        }
        
        // 新規プール作成
        VkDescriptorPool newPool = createPool(sizeClass, 256);
        poolList.push_back({newPool, 0, 256});
        return allocate(layout, sizeClass); // 再帰的に割り当て
    }

    void resetFrame() {
        // フレーム終了時に全プールをリセット
        for (auto pool : usedPools) {
            vkResetDescriptorPool(device, pool, 0);
        }
        usedPools.clear();
        
        for (auto& [sizeClass, poolList] : pools) {
            for (auto& pool : poolList) {
                pool.allocatedSets = 0;
            }
        }
    }
};
```

このパターンにより：

- 影描画パス（シンプルなディスクリプタ）と通常描画パス（複雑なディスクリプタ）で別プールを使用
- プールの断片化を防止
- vkResetDescriptorPoolで一括解放し、個別解放のオーバーヘッド削減

## まとめ：メモリアロケータ選択のガイドライン

Vulkanのメモリ管理を効率化するための要点：

- **デフォルトはVMAを使用**：[GPUOpen VMA](https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator)は実績があり、大半のケースで最適解
- **一時バッファはリニアアロケータ**：毎フレーム確保・リセットするUniform Bufferに最適
- **同サイズ頻繁確保はプールアロケータ**：パーティクル等の固定サイズリソース管理に有効
- **ステージングバッファは再利用**：VkFenceで転送完了を追跡し、複数フレームに渡って再利用
- **ディスクリプタセットはサイズクラス別プール**：用途別にプールを分け、フレーム終了時に一括リセット
- **Persistent Mappingを活用**：HOST_VISIBLEメモリは作成時にマップし、毎フレームのmap/unmapを削減
- **専用割り当ては慎重に**：レンダーターゲット等の大型リソースのみ専用割り当て（`VMA_ALLOCATION_CREATE_DEDICATED_MEMORY_BIT`）を検討

これらのパターンを適切に組み合わせることで、Vulkanアプリケーションのメモリ管理を大幅に簡素化し、パフォーマンスを最大化できます。

---

**Sources:**
- [Vulkan Memory Allocator - AMD GPUOpen](https://gpuopen.com/vulkan-memory-allocator/)
- [VMA Recommended Usage Patterns](https://gpuopen-librariesandsdks.github.io/VulkanMemoryAllocator/html/usage_patterns.html)
- [GitHub - VulkanMemoryAllocator](https://github.com/GPUOpen-LibrariesAndSDKs/VulkanMemoryAllocator)
- [Kyle Halladay - Custom Allocators for Vulkan](https://kylehalladay.com/blog/tutorial/2017/12/13/Custom-Allocators-Vulkan.html)
- [Writing an Efficient Vulkan Renderer - zeux.io](https://zeux.io/2020/02/27/writing-an-efficient-vulkan-renderer/)
- [Vulkan Memory Allocation Specification](https://docs.vulkan.org/spec/latest/chapters/memory.html)
- [Easy Memory Management with VMA - Baked Bits](https://bakedbits.dev/posts/vulkan-memory-allocator/)