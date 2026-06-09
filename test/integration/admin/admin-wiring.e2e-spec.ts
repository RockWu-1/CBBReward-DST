import { Prisma } from '@prisma/client';
import { AppModule } from '../../../src/app.module';
import { AdminModule } from '../../../src/modules/admin/admin.module';

describe('Admin wiring', () => {
  const getModel = (name: string) =>
    Prisma.dmmf.datamodel.models.find((model) => model.name === name);

  const getField = (modelName: string, fieldName: string) =>
    getModel(modelName)?.fields.find((field) => field.name === fieldName);

  it('should expose AdminUser model fields and constraints', () => {
    const model = getModel('AdminUser');
    expect(model).toBeDefined();

    const fieldNames = model?.fields.map((field) => field.name) ?? [];
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'id',
        'email',
        'passwordHash',
        'role',
        'isActive',
        'createdAt',
        'updatedAt',
      ]),
    );

    expect(getField('AdminUser', 'email')?.isUnique).toBe(true);
    expect(getField('AdminUser', 'passwordHash')?.type).toBe('String');
    expect(getField('AdminUser', 'role')?.type).toBe('AdminRole');
    expect(getField('AdminUser', 'isActive')?.type).toBe('Boolean');
  });

  it('should include AdminModule in AppModule imports', () => {
    const imports = Reflect.getMetadata('imports', AppModule) as unknown[];
    expect(imports).toEqual(expect.arrayContaining([AdminModule]));
  });

  it('should expose CustomerQuarterSnapshot model and remove OrderSnapshot model', () => {
    const snapshotModel = getModel('CustomerQuarterSnapshot');
    expect(snapshotModel).toBeDefined();

    const fieldNames = snapshotModel?.fields.map((field) => field.name) ?? [];
    expect(fieldNames).toEqual(
      expect.arrayContaining([
        'customerId',
        'season',
        'totalAmount',
        'bobAmount',
        'csAmount',
        'level',
      ]),
    );

    expect(getModel('OrderSnapshot')).toBeUndefined();
  });
});
