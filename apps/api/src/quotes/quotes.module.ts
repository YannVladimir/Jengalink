import { Module } from '@nestjs/common';
import { ProjectsModule } from '../projects/projects.module';
import { AgreementsController, QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';

@Module({
  imports: [ProjectsModule],
  controllers: [QuotesController, AgreementsController],
  providers: [QuotesService],
})
export class QuotesModule {}
