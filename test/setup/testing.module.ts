import { ModuleMetadata } from '@nestjs/common/interfaces/modules/module-metadata.interface';
import { Test, TestingModule } from '@nestjs/testing';

type TestingModuleOptions = Pick<ModuleMetadata, 'imports' | 'controllers' | 'providers' | 'exports'>;

export async function createTestingModule(
  options: TestingModuleOptions = {},
): Promise<TestingModule> {
  return Test.createTestingModule({
    imports: options.imports ?? [],
    controllers: options.controllers ?? [],
    providers: options.providers ?? [],
    exports: options.exports ?? [],
  }).compile();
}
