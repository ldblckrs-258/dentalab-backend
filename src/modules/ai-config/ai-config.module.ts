import { Module } from '@nestjs/common';
import { AiProviderController } from './controllers/ai-provider.controller';
import { AiModelController } from './controllers/ai-model.controller';
import { AiCryptoService } from './services/ai-crypto.service';
import { AiProviderService } from './services/ai-provider.service';
import { AiModelService } from './services/ai-model.service';
import { AiResolverService } from './services/ai-resolver.service';
import { ProviderModelDiscoveryService } from './services/provider-model-discovery.service';

@Module({
  controllers: [AiProviderController, AiModelController],
  providers: [
    AiCryptoService,
    AiProviderService,
    AiModelService,
    AiResolverService,
    ProviderModelDiscoveryService,
  ],
  exports: [AiResolverService],
})
export class AiConfigModule {}
