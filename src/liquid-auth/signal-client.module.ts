import { Module } from '@nestjs/common';
import { SignalClientManager } from './signal-client.manager';
import { SignalClientController } from './signal-client.controller';

@Module({
  providers: [SignalClientManager],
  controllers: [SignalClientController],
  exports: [SignalClientManager],
})
export class SignalClientModule {}
