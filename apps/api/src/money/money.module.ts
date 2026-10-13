import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { MoneyController } from './money.controller';
import { MoneyService } from './money.service';

@Module({
  imports: [ProjectsModule],
  controllers: [MoneyController],
  providers: [MoneyService],
  exports: [MoneyService],
})
export class MoneyModule {}
