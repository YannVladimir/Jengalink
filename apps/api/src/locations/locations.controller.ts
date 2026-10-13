import { Controller, Get, Query } from '@nestjs/common';
import { LocationOptions, LocationQuery } from '@jengalink/contracts';
import { Contract } from '../common/contract';
import { ZodPipe } from '../common/zod.pipe';
import { LocationsService } from './locations.service';

@Controller('locations')
export class LocationsController {
  constructor(private readonly locations: LocationsService) {}

  @Get('rw')
  @Contract({
    tag: 'Locations',
    summary:
      'Rwanda location picker: send the levels chosen so far, get the options for the next level',
    query: LocationQuery,
    response: LocationOptions,
  })
  rwanda(
    @Query(new ZodPipe(LocationQuery)) query: LocationQuery,
  ): LocationOptions {
    return this.locations.options(query);
  }
}
