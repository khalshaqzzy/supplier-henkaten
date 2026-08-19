import type { BoardMachineAssetKey } from '@tmmin-henkaten/contracts';

import assemblyFixture from '../../assets/board-machines/assembly-fixture.png';
import cncMachining from '../../assets/board-machines/cnc-machining.png';
import injectionMolding from '../../assets/board-machines/injection-molding.png';
import inspectionCmm from '../../assets/board-machines/inspection-cmm.png';
import materialRack from '../../assets/board-machines/material-rack.png';
import packingStation from '../../assets/board-machines/packing-station.png';
import pressStamping from '../../assets/board-machines/press-stamping.png';
import rollerConveyor from '../../assets/board-machines/roller-conveyor.png';
import spotWelding from '../../assets/board-machines/spot-welding.png';
import straightConveyor from '../../assets/board-machines/straight-conveyor.png';
import torqueStation from '../../assets/board-machines/torque-station.png';
import weldingRobot from '../../assets/board-machines/welding-robot.png';
import assemblyFixture2d from '../../assets/board-machines-2d/assembly-fixture-2d.png';
import cncMachining2d from '../../assets/board-machines-2d/cnc-machining-2d.png';
import injectionMolding2d from '../../assets/board-machines-2d/injection-molding-2d.png';
import inspectionCmm2d from '../../assets/board-machines-2d/inspection-cmm-2d.png';
import materialRack2d from '../../assets/board-machines-2d/material-rack-2d.png';
import packingStation2d from '../../assets/board-machines-2d/packing-station-2d.png';
import pressStamping2d from '../../assets/board-machines-2d/press-stamping-2d.png';
import rollerConveyor2d from '../../assets/board-machines-2d/roller-conveyor-2d.png';
import spotWelding2d from '../../assets/board-machines-2d/spot-welding-2d.png';
import straightConveyor2d from '../../assets/board-machines-2d/straight-conveyor-2d.png';
import torqueStation2d from '../../assets/board-machines-2d/torque-station-2d.png';
import weldingRobot2d from '../../assets/board-machines-2d/welding-robot-2d.png';

export type MachineAsset = {
  key: BoardMachineAssetKey;
  label: string;
  src: string;
  source: 'IMAGEGEN';
  style: 'ISOMETRIC' | 'SIMPLE_2D';
  aspectRatio: number;
  description: string;
  defaultSize: { width: number; height: number };
};

export const machineAssets: readonly MachineAsset[] = [
  asset('PRESS_STAMPING', 'Press / stamping', pressStamping, 410, 380, 'ISOMETRIC'),
  asset('INJECTION_MOLDING', 'Injection molding', injectionMolding, 470, 310, 'ISOMETRIC'),
  asset('WELDING_ROBOT', 'Welding robot', weldingRobot, 390, 300, 'ISOMETRIC'),
  asset('SPOT_WELDING', 'Spot welding', spotWelding, 390, 300, 'ISOMETRIC'),
  asset('CNC_MACHINING', 'CNC machining', cncMachining, 390, 300, 'ISOMETRIC'),
  asset('STRAIGHT_CONVEYOR', 'Belt conveyor', straightConveyor, 480, 250, 'ISOMETRIC'),
  asset('ROLLER_CONVEYOR', 'Roller conveyor', rollerConveyor, 480, 250, 'ISOMETRIC'),
  asset('ASSEMBLY_FIXTURE', 'Assembly fixture', assemblyFixture, 390, 300, 'ISOMETRIC'),
  asset('INSPECTION_CMM', 'Inspection / CMM', inspectionCmm, 390, 300, 'ISOMETRIC'),
  asset('TORQUE_STATION', 'Torque station', torqueStation, 390, 300, 'ISOMETRIC'),
  asset('MATERIAL_RACK', 'Material rack', materialRack, 360, 300, 'ISOMETRIC'),
  asset('PACKING_STATION', 'Packing station', packingStation, 470, 300, 'ISOMETRIC'),
  asset('PRESS_STAMPING_2D', 'Press / stamping', pressStamping2d, 360, 390, 'SIMPLE_2D'),
  asset('INJECTION_MOLDING_2D', 'Injection molding', injectionMolding2d, 470, 310, 'SIMPLE_2D'),
  asset('WELDING_ROBOT_2D', 'Welding robot', weldingRobot2d, 390, 355, 'SIMPLE_2D'),
  asset('SPOT_WELDING_2D', 'Spot welding', spotWelding2d, 390, 380, 'SIMPLE_2D'),
  asset('CNC_MACHINING_2D', 'CNC machining', cncMachining2d, 390, 325, 'SIMPLE_2D'),
  asset('STRAIGHT_CONVEYOR_2D', 'Belt conveyor', straightConveyor2d, 480, 320, 'SIMPLE_2D'),
  asset('ROLLER_CONVEYOR_2D', 'Roller conveyor', rollerConveyor2d, 480, 320, 'SIMPLE_2D'),
  asset('ASSEMBLY_FIXTURE_2D', 'Assembly fixture', assemblyFixture2d, 390, 355, 'SIMPLE_2D'),
  asset('INSPECTION_CMM_2D', 'Inspection / CMM', inspectionCmm2d, 470, 310, 'SIMPLE_2D'),
  asset('TORQUE_STATION_2D', 'Torque station', torqueStation2d, 300, 450, 'SIMPLE_2D'),
  asset('MATERIAL_RACK_2D', 'Material rack', materialRack2d, 470, 310, 'SIMPLE_2D'),
  asset('PACKING_STATION_2D', 'Packing station', packingStation2d, 470, 310, 'SIMPLE_2D'),
] as const;

export const machineAssetsByKey = new Map(machineAssets.map((item) => [item.key, item]));

export function machineAssetDisplayLabel(asset: MachineAsset) {
  return `${asset.label} · ${asset.style === 'SIMPLE_2D' ? '2D Simple' : 'Isometric'}`;
}

function asset(
  key: BoardMachineAssetKey,
  label: string,
  src: string,
  width: number,
  height: number,
  style: MachineAsset['style'],
): MachineAsset {
  return {
    key,
    label,
    src,
    source: 'IMAGEGEN',
    style,
    aspectRatio: width / height,
    description:
      style === 'SIMPLE_2D'
        ? `${label}, simple generic 2D industrial icon with transparent background`
        : `${label} industrial machine, transparent soft-isometric cutout`,
    defaultSize: { width, height },
  };
}
