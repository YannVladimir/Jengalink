import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import {
  ExportList,
  ExportView,
  QuotePdfLink,
  RequestExport,
} from '@jengalink/contracts';
import { type AuthUser, CurrentUser } from '../auth/auth.guard';
import { Contract } from '../common/contract';
import { ExportsService } from './exports.service';

const uuid = new ParseUUIDPipe({ version: '7' });

// Bodies are validated inside the service after the access check, so strangers always get 404.
@Controller('projects/:id/exports')
export class ExportsController {
  constructor(private readonly exports: ExportsService) {}

  @Get()
  @Contract({
    tag: 'Exports',
    summary: 'Your exports for this project, newest first',
    response: ExportList,
  })
  list(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
  ): Promise<ExportList> {
    return this.exports.list(auth.userId, id);
  }

  @Post()
  @Contract({
    tag: 'Exports',
    summary:
      'Ask for a project summary or the money history (PDF or CSV); it is made in the background',
    body: RequestExport,
    response: ExportView,
    status: 201,
  })
  request(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Body() body: unknown,
  ): Promise<ExportView> {
    return this.exports.request(auth.userId, id, body);
  }

  @Post(':exportId/download')
  @HttpCode(200)
  @Contract({
    tag: 'Exports',
    summary:
      'A 5-minute link to your export (money access is checked again now)',
    response: QuotePdfLink,
  })
  download(
    @CurrentUser() auth: AuthUser,
    @Param('id', uuid) id: string,
    @Param('exportId', uuid) exportId: string,
  ): Promise<QuotePdfLink> {
    return this.exports.download(auth.userId, id, exportId);
  }
}
